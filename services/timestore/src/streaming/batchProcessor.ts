import type { FastifyBaseLogger } from 'fastify';
import type { StreamingBatcherConfig } from '../config/serviceConfig';
import { processIngestionJob } from '../ingestion/processor';
import type { IngestionJobPayload, IngestionProcessingResult } from '../ingestion/types';
import { upsertStreamingWatermark, type UpsertStreamingWatermarkInput } from '../db/metadata';
import {
  observeStreamingRecords,
  observeStreamingFlush,
  updateStreamingBacklog,
  type StreamingFlushMetricsInput
} from '../observability/metrics';

const DEFAULT_RETRY_DELAY_MS = 5_000;

export type FlushReason = 'max_rows' | 'timer' | 'shutdown' | 'manual';

export interface StreamingBatchProcessorDependencies {
  ingest?: (payload: IngestionJobPayload) => Promise<IngestionProcessingResult>;
  persistWatermark?: (input: UpsertStreamingWatermarkInput) => Promise<void>;
  now?: () => number;
  retryDelayMs?: number;
}

interface WindowState {
  nextChunkIndex: number;
  activeChunkIndex: number | null;
  flushingChunks: Set<number>;
}

interface WindowBuffer {
  key: string;
  windowId: string;
  chunkIndex: number;
  windowStart: Date;
  windowEnd: Date;
  rows: Record<string, unknown>[];
  createdAtMs: number;
  lastUpdatedMs: number;
  flushTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
}

interface ParsedEvent {
  row: Record<string, unknown>;
  timestamp: Date;
}

export class StreamingBatchProcessor {
  private readonly ingest: (payload: IngestionJobPayload) => Promise<IngestionProcessingResult>;
  private readonly persistWatermark: (input: UpsertStreamingWatermarkInput) => Promise<void>;
  private readonly now: () => number;
  private readonly retryDelayMs: number;
  private readonly buffers = new Map<string, WindowBuffer>();
  private readonly windowStates = new Map<string, WindowState>();
  private readonly datasetSlug: string;

  constructor(
    private readonly config: StreamingBatcherConfig,
    private readonly logger: FastifyBaseLogger,
    dependencies: StreamingBatchProcessorDependencies = {}
  ) {
    this.ingest = dependencies.ingest ?? processIngestionJob;
    this.persistWatermark = dependencies.persistWatermark ?? upsertStreamingWatermark;
    this.now = dependencies.now ?? Date.now;
    this.retryDelayMs = dependencies.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.datasetSlug = config.datasetSlug;
  }

  async processRecord(event: Record<string, unknown>): Promise<void> {
    const parsed = this.parseEvent(event);
    if (!parsed) {
      return;
    }

    const windowId = parsed.timestampWindowStart.toISOString();
    const buffer = this.getOrCreateBuffer(windowId, parsed.timestampWindowStart, parsed.timestampWindowEnd);
    buffer.rows.push(parsed.row);
    buffer.lastUpdatedMs = this.now();
    observeStreamingRecords({ datasetSlug: this.datasetSlug, connectorId: this.config.id, count: 1 });

    if (buffer.rows.length >= this.config.maxRowsPerPartition) {
      await this.flushBuffer(buffer.key, 'max_rows');
    } else {
      this.ensureFlushTimer(buffer.key, buffer);
    }
  }

  async flushAll(reason: FlushReason = 'manual'): Promise<void> {
    const pending = Array.from(this.buffers.keys()).map((key) => this.flushBuffer(key, reason).catch((error) => {
      this.logger.error({ err: error, connectorId: this.config.id, bufferKey: key }, 'streaming batch flush failed during flushAll');
    }));
    await Promise.allSettled(pending);
  }

  private parseEvent(event: Record<string, unknown>): (ParsedEvent & { timestampWindowStart: Date; timestampWindowEnd: Date }) | null {
    const rawTimestamp = event[this.config.timeField];
    const timestamp = normalizeTimestamp(rawTimestamp);
    if (!timestamp) {
      this.logger.warn({ connectorId: this.config.id, field: this.config.timeField, value: rawTimestamp }, 'streaming event missing or invalid timestamp field');
      return null;
    }

    const row: Record<string, unknown> = { ...event };
    const windowStart = floorToWindow(timestamp, this.config.windowSeconds);
    const windowEnd = new Date(windowStart.getTime() + this.config.windowSeconds * 1000);

    return {
      row,
      timestamp,
      timestampWindowStart: windowStart,
      timestampWindowEnd: windowEnd
    };
  }

  private getOrCreateBuffer(windowId: string, windowStart: Date, windowEnd: Date): WindowBuffer {
    const state = this.getOrCreateWindowState(windowId);

    if (state.activeChunkIndex !== null) {
      const activeKey = buildBufferKey(windowId, state.activeChunkIndex);
      const existing = this.buffers.get(activeKey);
      if (existing) {
        return existing;
      }
      state.activeChunkIndex = null;
    }

    const chunkIndex = state.nextChunkIndex;
    state.nextChunkIndex += 1;
    state.activeChunkIndex = chunkIndex;

    const key = buildBufferKey(windowId, chunkIndex);
    const buffer: WindowBuffer = {
      key,
      windowId,
      chunkIndex,
      windowStart,
      windowEnd,
      rows: [],
      createdAtMs: this.now(),
      lastUpdatedMs: this.now(),
      flushTimer: null,
      retryTimer: null
    };
    this.buffers.set(key, buffer);
    this.ensureFlushTimer(key, buffer);
    return buffer;
  }

  private ensureFlushTimer(key: string, buffer: WindowBuffer): void {
    if (buffer.flushTimer) {
      return;
    }
    buffer.flushTimer = setTimeout(() => {
      void this.flushBuffer(key, 'timer').catch((error) => {
        this.logger.error({ err: error, connectorId: this.config.id, bufferKey: key }, 'streaming batch timer flush failed');
      });
    }, this.config.maxBatchLatencyMs);
    if (typeof buffer.flushTimer.unref === 'function') {
      buffer.flushTimer.unref();
    }
  }

  private clearFlushTimer(buffer: WindowBuffer): void {
    if (buffer.flushTimer) {
      clearTimeout(buffer.flushTimer);
      buffer.flushTimer = null;
    }
  }

  private async flushBuffer(key: string, reason: FlushReason): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer) {
      return;
    }
    if (buffer.rows.length === 0) {
      this.clearFlushTimer(buffer);
      this.buffers.delete(key);
      return;
    }

    this.clearFlushTimer(buffer);
    const state = this.windowStates.get(buffer.windowId);
    if (state && state.activeChunkIndex === buffer.chunkIndex) {
      state.activeChunkIndex = null;
    }
    this.buffers.delete(key);
    state?.flushingChunks.add(buffer.chunkIndex);

    try {
      await this.performFlush(buffer, reason);
      if (state) {
        state.flushingChunks.delete(buffer.chunkIndex);
        this.cleanupWindowState(buffer.windowId, state);
      }
    } catch (error) {
      if (state) {
        state.flushingChunks.delete(buffer.chunkIndex);
        if (state.activeChunkIndex === null) {
          state.activeChunkIndex = buffer.chunkIndex;
        }
      }
      this.buffers.set(key, buffer);
      this.ensureRetryTimer(key, buffer);
      this.logger.warn(
        {
          err: error,
          connectorId: this.config.id,
          bufferKey: key,
          flushReason: reason
        },
        'streaming batch flush failed; scheduled retry'
      );
    }
  }

  private ensureRetryTimer(key: string, buffer: WindowBuffer): void {
    if (buffer.retryTimer) {
      return;
    }
    buffer.retryTimer = setTimeout(() => {
      buffer.retryTimer = null;
      void this.flushBuffer(key, 'manual').catch((error) => {
        this.logger.error({ err: error, connectorId: this.config.id, bufferKey: key }, 'streaming batch retry flush failed');
      });
    }, this.retryDelayMs);
    if (typeof buffer.retryTimer.unref === 'function') {
      buffer.retryTimer.unref();
    }
  }

  private async performFlush(buffer: WindowBuffer, reason: FlushReason): Promise<void> {
    const rows = [...buffer.rows];
    rows.sort((a, b) => compareByTimeField(a, b, this.config.timeField));

    const chunkLabel = buffer.chunkIndex.toString();
    const partitionKey = {
      ...this.config.partitionKey,
      window: buffer.windowStart.toISOString(),
      chunk: chunkLabel
    } satisfies Record<string, string>;

    const partitionAttributes = {
      ...this.config.partitionAttributes,
      window_end: buffer.windowEnd.toISOString(),
      chunk: chunkLabel,
      flush_reason: reason
    } satisfies Record<string, string>;

    const payload: IngestionJobPayload = {
      datasetSlug: this.config.datasetSlug,
      datasetName: this.config.datasetName,
      tableName: this.config.tableName,
      schema: this.config.schema,
      partition: {
        key: partitionKey,
        attributes: partitionAttributes,
        timeRange: {
          start: buffer.windowStart.toISOString(),
          end: buffer.windowEnd.toISOString()
        }
      },
      rows,
      idempotencyKey: `${this.config.id}:${buffer.windowStart.toISOString()}:${chunkLabel}`,
      receivedAt: new Date().toISOString()
    };

    const ingestStart = this.now();
    const result = await this.ingest(payload);
    const ingestDurationSeconds = (this.now() - ingestStart) / 1_000;

    observeStreamingFlush({
      datasetSlug: this.config.datasetSlug,
      connectorId: this.config.id,
      rows: rows.length,
      durationSeconds: ingestDurationSeconds,
      reason
    } satisfies StreamingFlushMetricsInput);

    const lagSeconds = Math.max(0, (this.now() - buffer.windowEnd.getTime()) / 1_000);
    updateStreamingBacklog({
      datasetSlug: this.config.datasetSlug,
      connectorId: this.config.id,
      lagSeconds,
      openWindows: this.getOpenWindowCount()
    });

    await this.persistWatermark({
      connectorId: this.config.id,
      datasetId: result.dataset.id,
      datasetSlug: result.dataset.slug ?? this.config.datasetSlug,
      sealedThrough: buffer.windowEnd,
      backlogLagMs: Math.round(lagSeconds * 1_000),
      recordsProcessedDelta: rows.length
    });
  }

  private getOpenWindowCount(): number {
    let total = 0;
    for (const state of this.windowStates.values()) {
      if (state.activeChunkIndex !== null || state.flushingChunks.size > 0) {
        total += 1;
      }
    }
    return total;
  }

  private getOrCreateWindowState(windowId: string): WindowState {
    let state = this.windowStates.get(windowId);
    if (!state) {
      state = {
        nextChunkIndex: 0,
        activeChunkIndex: null,
        flushingChunks: new Set<number>()
      } satisfies WindowState;
      this.windowStates.set(windowId, state);
    }
    return state;
  }

  private cleanupWindowState(windowId: string, state: WindowState): void {
    if (state.activeChunkIndex === null && state.flushingChunks.size === 0) {
      this.windowStates.delete(windowId);
    }
  }
}

function buildBufferKey(windowId: string, chunkIndex: number): string {
  return `${windowId}#${chunkIndex}`;
}

function floorToWindow(timestamp: Date, windowSeconds: number): Date {
  const totalSeconds = Math.floor(timestamp.getTime() / 1000);
  const windowStartSeconds = totalSeconds - (totalSeconds % windowSeconds);
  return new Date(windowStartSeconds * 1000);
}

function normalizeTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function compareByTimeField(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  field: string
): number {
  const leftValue = normalizeTimestamp(left[field]);
  const rightValue = normalizeTimestamp(right[field]);
  if (!leftValue || !rightValue) {
    return 0;
  }
  return leftValue.getTime() - rightValue.getTime();
}
