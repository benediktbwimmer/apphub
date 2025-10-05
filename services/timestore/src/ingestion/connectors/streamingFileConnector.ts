import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import {
  ingestionJobPayloadSchema,
  ingestionRequestSchema,
  type IngestionJobPayload,
  type IngestionRequest
} from '../types';
import { enqueueIngestionJob, getIngestionQueueDepth } from '../../queue';
import { StagingQueueFullError } from '../stagingManager';
import type {
  ConnectorBackpressureConfig,
  StreamingConnectorConfig
} from '../../config/serviceConfig';
import { BackpressureController } from './backpressure';
import {
  JsonFileCheckpointStore,
  defaultCheckpointPath,
  type ConnectorCheckpointStore
} from './checkpoints';
import { delay } from './utils';

const streamingEnvelopeSchema = z.object({
  offset: z.union([z.string(), z.number()]).transform((value) => value.toString()),
  idempotencyKey: z.string().min(1).optional(),
  ingestion: ingestionRequestSchema.extend({
    receivedAt: z.string().optional()
  })
});

export type StreamingConnectorDependencies = {
  queueDepthProvider?: () => Promise<number>;
  enqueue?: (payload: IngestionJobPayload) => Promise<void>;
};

interface StreamingCheckpointState {
  lastLine: number;
  lastOffset: string | null;
  dedupe: Array<{ key: string; expiresAt: number }>;
}

const DEFAULT_STREAMING_CHECKPOINT_STATE: StreamingCheckpointState = {
  lastLine: -1,
  lastOffset: null,
  dedupe: []
};

class DedupCache {
  private readonly entries = new Map<string, number>();

  constructor(private readonly ttlMs: number, initial: Array<{ key: string; expiresAt: number }>) {
    this.reset(initial);
  }

  has(key: string): boolean {
    this.prune();
    const expiresAt = this.entries.get(key);
    if (!expiresAt) {
      return false;
    }
    if (expiresAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): void {
    this.prune();
    this.entries.set(key, Date.now() + this.ttlMs);
  }

  snapshot(): Array<{ key: string; expiresAt: number }> {
    this.prune();
    return Array.from(this.entries.entries()).map(([key, expiresAt]) => ({ key, expiresAt }));
  }

  reset(entries: Array<{ key: string; expiresAt: number }>): void {
    this.entries.clear();
    const now = Date.now();
    for (const entry of entries) {
      if (!entry?.key || typeof entry.expiresAt !== 'number') {
        continue;
      }
      if (entry.expiresAt > now) {
        this.entries.set(entry.key, entry.expiresAt);
      }
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries.entries()) {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export class FileStreamingConnector {
  private readonly logger: FastifyBaseLogger;
  private readonly backpressure: BackpressureController;
  private readonly checkpointStore: ConnectorCheckpointStore<StreamingCheckpointState>;
  private readonly queueDepthProvider: () => Promise<number>;
  private readonly enqueue: (payload: IngestionJobPayload) => Promise<void>;
  private readonly dedupe: DedupCache;
  private state: StreamingCheckpointState = { ...DEFAULT_STREAMING_CHECKPOINT_STATE };
  private loop: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly config: StreamingConnectorConfig,
    logger: FastifyBaseLogger,
    backpressureConfig: ConnectorBackpressureConfig,
    dependencies: StreamingConnectorDependencies = {}
  ) {
    this.logger = logger;
    this.backpressure = new BackpressureController(backpressureConfig);
    const checkpointPath = config.checkpointPath
      ? config.checkpointPath
      : defaultCheckpointPath(config.path, config.id, 'checkpoint.json');
    this.checkpointStore = new JsonFileCheckpointStore(checkpointPath);
    this.queueDepthProvider = dependencies.queueDepthProvider
      ? dependencies.queueDepthProvider
      : async () => getIngestionQueueDepth();
    this.enqueue = dependencies.enqueue
      ? dependencies.enqueue
      : async (payload: IngestionJobPayload) => {
          await enqueueIngestionJob(payload);
        };
    this.dedupe = new DedupCache(config.dedupeWindowMs, []);
  }

  async start(): Promise<void> {
    const stored = await this.checkpointStore.load(DEFAULT_STREAMING_CHECKPOINT_STATE);
    this.state = { ...DEFAULT_STREAMING_CHECKPOINT_STATE, ...stored };
    this.dedupe.reset(stored.dedupe ?? []);

    if (!this.config.startAtOldest && this.state.lastLine < 0) {
      this.state.lastLine = await this.resolveLatestLineIndex();
      await this.persistState();
    }

    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.loop) {
      try {
        await this.loop;
      } finally {
        this.loop = null;
      }
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const depth = await this.queueDepthProvider();
        const decision = this.backpressure.evaluate(depth);
        if (decision.shouldPause) {
          this.logger.debug({ connectorId: this.config.id, queueDepth: depth, delayMs: decision.delayMs }, 'streaming connector paused by backpressure');
          await delay(decision.delayMs);
          continue;
        }

        const processed = await this.processNewEntries();
        if (!processed) {
          await delay(this.config.pollIntervalMs);
        }
      } catch (error) {
        this.logger.error({ err: error, connectorId: this.config.id }, 'streaming connector iteration failed');
        await delay(Math.min(this.config.pollIntervalMs * 2, 10_000));
      }
    }
  }

  private async processNewEntries(): Promise<boolean> {
    const lines = await this.readLines();
    if (!lines) {
      return false;
    }

    const startIndex = this.state.lastLine + 1;
    if (startIndex >= lines.length) {
      return false;
    }

    let processed = false;
    let stateChanged = false;

    for (let index = startIndex; index < lines.length; index += 1) {
      const rawLine = lines[index];
      this.state.lastLine = index;
      stateChanged = true;
      if (!rawLine || rawLine.trim().length === 0) {
        continue;
      }

      let envelope: z.infer<typeof streamingEnvelopeSchema> | null = null;
      try {
        const parsed = JSON.parse(rawLine) as unknown;
        envelope = streamingEnvelopeSchema.parse(parsed);
      } catch (error) {
        await this.writeDlq({
          reason: 'parse-error',
          error: error instanceof Error ? error.message : error,
          connectorId: this.config.id,
          line: index,
          raw: rawLine
        });
        this.logger.warn({ err: error, connectorId: this.config.id, line: index }, 'failed to parse streaming envelope');
        continue;
      }

      this.state.lastOffset = envelope.offset;

      const payload = this.buildPayload(envelope, index);
      if (!payload) {
        continue;
      }
      const dedupeKey = payload.idempotencyKey ?? `stream:${this.config.id}:${envelope.offset}`;
      if (this.dedupe.has(dedupeKey)) {
        continue;
      }

      try {
        await this.enqueueWithBackpressure(payload);
        this.dedupe.add(dedupeKey);
        processed = true;
        await this.persistState();
      } catch (error) {
        await this.writeDlq({
          reason: 'enqueue-error',
          error: error instanceof Error ? error.message : error,
          connectorId: this.config.id,
          line: index,
          envelope
        });
        this.logger.error({ err: error, connectorId: this.config.id, line: index }, 'failed to enqueue ingestion job from streaming connector');
      }
    }

    if (stateChanged) {
      await this.persistState();
    }

    return processed;
  }

  private buildPayload(
    envelope: z.infer<typeof streamingEnvelopeSchema>,
    line: number
  ): IngestionJobPayload | null {
    const request: IngestionRequest & { receivedAt?: string } = envelope.ingestion;
    const receivedAt = request.receivedAt ?? new Date().toISOString();
    const idempotencyKey = request.idempotencyKey ?? envelope.idempotencyKey ?? `stream:${this.config.id}:${envelope.offset || line}`;

    try {
      return ingestionJobPayloadSchema.parse({
        ...request,
        idempotencyKey,
        receivedAt
      });
    } catch (error) {
      void this.writeDlq({
        reason: 'validation-error',
        error: error instanceof Error ? error.message : error,
        connectorId: this.config.id,
        line,
        envelope
      });
      this.logger.warn({ err: error, connectorId: this.config.id, line }, 'streaming envelope failed validation');
      return null;
    }
  }

  private async writeDlq(entry: Record<string, unknown>): Promise<void> {
    if (!this.config.dlqPath) {
      return;
    }
    try {
      const directory = path.dirname(this.config.dlqPath);
      await fs.mkdir(directory, { recursive: true });
      await fs.appendFile(this.config.dlqPath, `${JSON.stringify({ ...entry, timestamp: new Date().toISOString() })}\n`, 'utf8');
    } catch (error) {
      this.logger.error({ err: error, connectorId: this.config.id }, 'failed to write streaming connector DLQ entry');
    }
  }

  private async persistState(): Promise<void> {
    try {
      await this.checkpointStore.save({
        lastLine: this.state.lastLine,
        lastOffset: this.state.lastOffset,
        dedupe: this.dedupe.snapshot()
      });
    } catch (error) {
      this.logger.error({ err: error, connectorId: this.config.id }, 'failed to persist streaming connector checkpoint');
    }
  }

  private async readLines(): Promise<string[] | null> {
    try {
      const raw = await fs.readFile(this.config.path, 'utf8');
      return raw.replace(/\r\n/g, '\n').split('\n');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return null;
      }
      this.logger.error({ err: error, connectorId: this.config.id }, 'failed to read streaming connector source');
      return null;
    }
  }

  private async resolveLatestLineIndex(): Promise<number> {
    const lines = await this.readLines();
    if (!lines) {
      return -1;
    }
    return Math.max(lines.length - 1, -1);
  }

  private async enqueueWithBackpressure(payload: IngestionJobPayload): Promise<void> {
    while (!this.stopped) {
      try {
        await this.enqueue(payload);
        return;
      } catch (error) {
        if (error instanceof StagingQueueFullError) {
          this.logger.warn(
            {
              connectorId: this.config.id,
              datasetSlug: payload.datasetSlug
            },
            'staging queue full; backing off before retry'
          );
          await delay(Math.max(50, this.config.pollIntervalMs));
          continue;
        }
        throw error;
      }
    }
    throw new Error('streaming connector stopped while waiting to enqueue payload');
  }

}
