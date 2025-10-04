import type { FastifyBaseLogger } from 'fastify';
import { Kafka, logLevel, type Consumer } from 'kafkajs';
import type {
  ServiceConfig,
  StreamingBatcherConfig,
  StreamingHotBufferConfig
} from '../config/serviceConfig';
import { listStreamingWatermarks } from '../db/metadata';
import {
  setStreamingHotBufferMetrics,
  type StreamingHotBufferDatasetState
} from '../observability/metrics';

export interface HotBufferQueryOptions {
  rangeStart: Date;
  rangeEnd: Date;
  limit?: number;
  timestampColumn: string;
}

export interface HotBufferQueryResult {
  rows: Record<string, unknown>[];
  watermark: string | null;
  latestTimestamp: string | null;
  bufferState: 'disabled' | 'ready' | 'unavailable';
}

export interface HotBufferStatus {
  enabled: boolean;
  state: 'disabled' | 'ready' | 'unavailable';
  datasets: number;
  healthy: boolean;
  lastRefreshAt: string | null;
  lastIngestAt: string | null;
}

interface BufferEvent {
  timestampMs: number;
  row: Record<string, unknown>;
}

interface DatasetBuffer {
  events: BufferEvent[];
  watermarkMs: number;
  latestTimestampMs: number | null;
}

function toTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function insertSorted(events: BufferEvent[], entry: BufferEvent): void {
  if (events.length === 0 || events[events.length - 1]!.timestampMs <= entry.timestampMs) {
    events.push(entry);
    return;
  }
  let low = 0;
  let high = events.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid]!.timestampMs <= entry.timestampMs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  events.splice(low, 0, entry);
}

export class HotBufferStore {
  private readonly buffers = new Map<string, DatasetBuffer>();
  private totalRows = 0;

  constructor(private readonly config: StreamingHotBufferConfig) {}

  ingest(datasetSlug: string, row: Record<string, unknown>, timestampMs: number): void {
    if (!this.config.enabled) {
      return;
    }
    const buffer = this.ensureBuffer(datasetSlug);
    if (timestampMs <= buffer.watermarkMs) {
      return;
    }
    insertSorted(buffer.events, { timestampMs, row });
    this.totalRows += 1;
    if (!buffer.latestTimestampMs || timestampMs > buffer.latestTimestampMs) {
      buffer.latestTimestampMs = timestampMs;
    }
    this.pruneDataset(datasetSlug, buffer);
    this.enforceGlobalLimit();
  }

  setWatermark(datasetSlug: string, watermarkMs: number): void {
    const buffer = this.ensureBuffer(datasetSlug);
    buffer.watermarkMs = Math.max(0, watermarkMs);
    this.pruneDataset(datasetSlug, buffer);
  }

  query(datasetSlug: string, options: HotBufferQueryOptions): {
    rows: Record<string, unknown>[];
    watermarkMs: number | null;
    latestTimestampMs: number | null;
  } {
    const buffer = this.buffers.get(datasetSlug);
    if (!buffer || buffer.events.length === 0) {
      return {
        rows: [],
        watermarkMs: null,
        latestTimestampMs: null
      };
    }

    const startBoundary = Math.max(
      options.rangeStart.getTime(),
      buffer.watermarkMs
    );
    const endBoundary = options.rangeEnd.getTime();
    const rows: Record<string, unknown>[] = [];

    for (const event of buffer.events) {
      if (event.timestampMs <= startBoundary) {
        continue;
      }
      if (event.timestampMs > endBoundary) {
        break;
      }
      rows.push(event.row);
      if (options.limit && rows.length >= options.limit) {
        break;
      }
    }

    return {
      rows,
      watermarkMs: buffer.watermarkMs > 0 ? buffer.watermarkMs : null,
      latestTimestampMs: buffer.latestTimestampMs
    };
  }

  datasetCount(): number {
    return this.buffers.size;
  }

  diagnostics(): Array<{
    datasetSlug: string;
    rows: number;
    watermarkMs: number | null;
    latestTimestampMs: number | null;
  }> {
    const snapshot: Array<{
      datasetSlug: string;
      rows: number;
      watermarkMs: number | null;
      latestTimestampMs: number | null;
    }> = [];
    this.buffers.forEach((buffer, dataset) => {
      snapshot.push({
        datasetSlug: dataset,
        rows: buffer.events.length,
        watermarkMs: buffer.watermarkMs > 0 ? buffer.watermarkMs : null,
        latestTimestampMs: buffer.latestTimestampMs
      });
    });
    return snapshot;
  }

  clear(): void {
    this.buffers.clear();
    this.totalRows = 0;
  }

  private ensureBuffer(datasetSlug: string): DatasetBuffer {
    let buffer = this.buffers.get(datasetSlug);
    if (!buffer) {
      buffer = {
        events: [],
        watermarkMs: 0,
        latestTimestampMs: null
      } satisfies DatasetBuffer;
      this.buffers.set(datasetSlug, buffer);
    }
    return buffer;
  }

  private pruneDataset(datasetSlug: string, buffer: DatasetBuffer): void {
    const retentionCutoff = Date.now() - this.config.retentionSeconds * 1000;
    let removed = 0;
    while (buffer.events.length > 0) {
      const head = buffer.events[0]!;
      if (head.timestampMs <= buffer.watermarkMs || head.timestampMs < retentionCutoff) {
        buffer.events.shift();
        removed += 1;
        continue;
      }
      break;
    }
    if (removed > 0) {
      this.totalRows = Math.max(0, this.totalRows - removed);
    }
    while (buffer.events.length > this.config.maxRowsPerDataset) {
      buffer.events.shift();
      this.totalRows = Math.max(0, this.totalRows - 1);
    }
    buffer.latestTimestampMs = buffer.events.length > 0
      ? buffer.events[buffer.events.length - 1]!.timestampMs
      : null;
  }

  private enforceGlobalLimit(): void {
    const maxTotal = this.config.maxTotalRows;
    if (!maxTotal || maxTotal <= 0) {
      return;
    }
    while (this.totalRows > maxTotal) {
      const oldestEntry = this.findOldestDatasetEntry();
      if (!oldestEntry) {
        break;
      }
      const buffer = this.buffers.get(oldestEntry.dataset);
      if (!buffer || buffer.events.length === 0) {
        break;
      }
      buffer.events.shift();
      this.totalRows = Math.max(0, this.totalRows - 1);
      buffer.latestTimestampMs = buffer.events.length > 0
        ? buffer.events[buffer.events.length - 1]!.timestampMs
        : null;
    }
  }

  private findOldestDatasetEntry(): { dataset: string; timestampMs: number } | null {
    let result: { dataset: string; timestampMs: number } | null = null;
    this.buffers.forEach((buffer, dataset) => {
      if (buffer.events.length === 0) {
        return;
      }
      const candidate = buffer.events[0]!;
      if (!result || candidate.timestampMs < (result?.timestampMs ?? Number.POSITIVE_INFINITY)) {
        result = { dataset, timestampMs: candidate.timestampMs };
      }
    });
    return result;
  }
}

class StreamingHotBufferManager {
  private readonly store: HotBufferStore;
  private readonly kafka: Kafka;
  private readonly consumers: Consumer[] = [];
  private watermarkTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private healthy = true;
  private started = false;
  private lastRefreshAtMs: number | null = null;
  private lastIngestAtMs: number | null = null;

  constructor(
    private readonly config: StreamingHotBufferConfig,
    private readonly batchers: StreamingBatcherConfig[],
    private readonly brokerUrl: string,
    private readonly logger: FastifyBaseLogger
  ) {
    this.store = new HotBufferStore(config);
    this.kafka = new Kafka({
      clientId: 'timestore-hot-buffer',
      brokers: [brokerUrl],
      logLevel: logLevel.ERROR
    });
  }

  getStore(): HotBufferStore {
    return this.store;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    await this.refreshWatermarks();
    this.publishMetrics();

    for (const batcher of this.batchers) {
      try {
        const consumer = this.kafka.consumer({ groupId: `timestore-hot-buffer-${batcher.id}` });
        await consumer.connect();
        await consumer.subscribe({ topic: batcher.topic, fromBeginning: batcher.startFromEarliest });
        const datasetSlug = batcher.datasetSlug;
        const timeField = batcher.timeField;
        consumer
          .run({
            eachMessage: async ({ message }) => {
              if (!message.value) {
                return;
              }
              try {
                const payload = JSON.parse(message.value.toString('utf8'));
                if (!payload || typeof payload !== 'object') {
                  return;
                }
                const timestamp = toTimestampMs((payload as Record<string, unknown>)[timeField]);
                if (!timestamp) {
                  this.logger.debug({ datasetSlug }, 'hot buffer skipped event with invalid timestamp');
                  return;
                }
                this.store.ingest(datasetSlug, payload as Record<string, unknown>, timestamp);
                this.lastIngestAtMs = Date.now();
                this.publishMetrics();
              } catch (error) {
                this.logger.warn({ err: error, datasetSlug }, 'hot buffer failed to process streaming event');
              }
            }
          })
          .catch((error) => {
            this.healthy = false;
            this.logger.error({ err: error, datasetSlug }, 'hot buffer consumer terminated unexpectedly');
            this.publishMetrics();
          });
        this.consumers.push(consumer);
      } catch (error) {
        this.healthy = false;
        this.logger.error({ err: error, connectorId: batcher.id }, 'failed to start hot buffer consumer');
        this.publishMetrics();
      }
    }

    const refreshInterval = Math.max(this.config.refreshWatermarkMs, 1_000);
    this.watermarkTimer = setInterval(() => {
      void this.refreshWatermarks().catch((error) => {
        this.healthy = false;
        this.logger.error({ err: error }, 'hot buffer failed to refresh watermarks');
        this.publishMetrics();
      });
    }, refreshInterval);
    if (typeof this.watermarkTimer.unref === 'function') {
      this.watermarkTimer.unref();
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    this.metricsTimer = setInterval(() => {
      this.publishMetrics();
    }, Math.max(this.config.refreshWatermarkMs, 5_000));
    if (this.metricsTimer && typeof this.metricsTimer.unref === 'function') {
      this.metricsTimer.unref();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (this.watermarkTimer) {
      clearInterval(this.watermarkTimer);
      this.watermarkTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    const shutdowns = this.consumers.map((consumer) => consumer.stop().then(() => consumer.disconnect()).catch(() => undefined));
    this.consumers.length = 0;
    await Promise.allSettled(shutdowns);
    this.store.clear();
    this.publishMetrics();
    setStreamingHotBufferMetrics({ enabled: false, datasets: [] });
  }

  query(datasetSlug: string, options: HotBufferQueryOptions): HotBufferQueryResult {
    if (!this.config.enabled) {
      return {
        rows: [],
        watermark: null,
        latestTimestamp: null,
        bufferState: 'disabled'
      };
    }

    if (!this.healthy) {
      return {
        rows: [],
        watermark: null,
        latestTimestamp: null,
        bufferState: 'unavailable'
      };
    }

    const { rows, watermarkMs, latestTimestampMs } = this.store.query(datasetSlug, options);
    return {
      rows,
      watermark: watermarkMs ? new Date(watermarkMs).toISOString() : null,
      latestTimestamp: latestTimestampMs ? new Date(latestTimestampMs).toISOString() : null,
      bufferState: 'ready'
    } satisfies HotBufferQueryResult;
  }

  status(): HotBufferStatus {
    if (!this.config.enabled) {
      return {
        enabled: false,
        state: 'disabled',
        datasets: 0,
        healthy: true,
        lastRefreshAt: null,
        lastIngestAt: null
      } satisfies HotBufferStatus;
    }
    return {
      enabled: true,
      state: this.healthy ? 'ready' : 'unavailable',
      datasets: this.store.datasetCount(),
      healthy: this.healthy,
      lastRefreshAt: this.lastRefreshAtMs ? new Date(this.lastRefreshAtMs).toISOString() : null,
      lastIngestAt: this.lastIngestAtMs ? new Date(this.lastIngestAtMs).toISOString() : null
    } satisfies HotBufferStatus;
  }

  private async refreshWatermarks(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    const records = await listStreamingWatermarks();
    for (const record of records) {
      const parsed = Date.parse(record.sealedThrough);
      if (Number.isNaN(parsed)) {
        continue;
      }
      this.store.setWatermark(record.datasetSlug, parsed);
    }
    this.lastRefreshAtMs = Date.now();
    this.publishMetrics();
  }

  private publishMetrics(): void {
    try {
      if (!this.config.enabled) {
        setStreamingHotBufferMetrics({ enabled: false, datasets: [] });
        return;
      }
      const datasetState: StreamingHotBufferDatasetState = this.healthy ? 'ready' : 'unavailable';
      const diagnostics = this.store.diagnostics();
      const now = Date.now();
      const datasets = diagnostics.map((entry) => {
        const latestSeconds = entry.latestTimestampMs ? Math.floor(entry.latestTimestampMs / 1_000) : null;
        const watermarkSeconds = entry.watermarkMs ? Math.floor(entry.watermarkMs / 1_000) : null;
        const stalenessSeconds = entry.latestTimestampMs
          ? Math.max(0, Math.round((now - entry.latestTimestampMs) / 1_000))
          : null;
        return {
          datasetSlug: entry.datasetSlug,
          rows: entry.rows,
          watermarkEpochSeconds: watermarkSeconds,
          latestEpochSeconds: latestSeconds,
          state: datasetState,
          stalenessSeconds
        };
      });
      setStreamingHotBufferMetrics({
        enabled: this.config.enabled,
        datasets
      });
    } catch (error) {
      this.logger.debug({ err: error }, 'hot buffer metrics publication failed');
    }
  }
}

let manager: StreamingHotBufferManager | null = null;
let testHarness:
  | {
      store: HotBufferStore;
      state: 'ready' | 'unavailable';
      enabled: boolean;
    }
  | null = null;

export function setHotBufferTestHarness(harness: {
  store: HotBufferStore;
  state?: 'ready' | 'unavailable';
  enabled?: boolean;
} | null): void {
  testHarness = harness
    ? {
        store: harness.store,
        state: harness.state ?? 'ready',
        enabled: harness.enabled ?? true
      }
    : null;
}

export function getHotBufferTestStore(): HotBufferStore | null {
  return testHarness?.store ?? null;
}

export async function initializeStreamingHotBuffer(
  params: { config: ServiceConfig; logger: FastifyBaseLogger }
): Promise<void> {
  if (testHarness) {
    setStreamingHotBufferMetrics({ enabled: Boolean(testHarness?.enabled), datasets: [] });
    return;
  }
  if (manager) {
    await manager.stop().catch(() => undefined);
    manager = null;
  }
  const runtime = params.config.streaming;
  if (!runtime.hotBuffer.enabled || !runtime.brokerUrl || runtime.batchers.length === 0) {
    setStreamingHotBufferMetrics({ enabled: false, datasets: [] });
    return;
  }
  manager = new StreamingHotBufferManager(runtime.hotBuffer, runtime.batchers, runtime.brokerUrl, params.logger);
  await manager.start();
}

export async function shutdownStreamingHotBuffer(): Promise<void> {
  if (manager) {
    await manager.stop().catch(() => undefined);
    manager = null;
  }
  setStreamingHotBufferMetrics({ enabled: false, datasets: [] });
  testHarness = null;
}

function resolveResultState(): 'disabled' | 'ready' | 'unavailable' {
  if (testHarness) {
    if (!testHarness.enabled) {
      return 'disabled';
    }
    return testHarness.state;
  }
  if (!manager) {
    return 'disabled';
  }
  return manager.status().state;
}

export function queryStreamingHotBuffer(
  datasetSlug: string,
  options: HotBufferQueryOptions
): HotBufferQueryResult {
  if (testHarness) {
    if (!testHarness.enabled) {
      return {
        rows: [],
        watermark: null,
        latestTimestamp: null,
        bufferState: 'disabled'
      };
    }
    const { rows, watermarkMs, latestTimestampMs } = testHarness.store.query(datasetSlug, options);
    return {
      rows,
      watermark: watermarkMs ? new Date(watermarkMs).toISOString() : null,
      latestTimestamp: latestTimestampMs ? new Date(latestTimestampMs).toISOString() : null,
      bufferState: testHarness.state
    } satisfies HotBufferQueryResult;
  }
  if (!manager) {
    return {
      rows: [],
      watermark: null,
      latestTimestamp: null,
      bufferState: 'disabled'
    } satisfies HotBufferQueryResult;
  }
  return manager.query(datasetSlug, options);
}

export function getStreamingHotBufferStatus(): HotBufferStatus {
  if (testHarness) {
    return {
      enabled: testHarness.enabled,
      state: testHarness.enabled ? testHarness.state : 'disabled',
      datasets: testHarness.store.datasetCount(),
      healthy: testHarness.enabled ? testHarness.state === 'ready' : true,
      lastRefreshAt: null,
      lastIngestAt: null
    } satisfies HotBufferStatus;
  }
  if (!manager) {
    return {
      enabled: false,
      state: 'disabled',
      datasets: 0,
      healthy: true,
      lastRefreshAt: null,
      lastIngestAt: null
    } satisfies HotBufferStatus;
  }
  return manager.status();
}
