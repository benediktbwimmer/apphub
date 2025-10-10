import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import {
  ingestionJobPayloadSchema,
  ingestionRequestSchema,
  type IngestionJobPayload
} from '../types';
import { enqueueIngestionJob, getIngestionQueueDepth } from '../../queue';
import type {
  BulkConnectorConfig,
  ConnectorBackpressureConfig
} from '../../config/serviceConfig';
import { BackpressureController } from './backpressure';
import {
  JsonFileCheckpointStore,
  defaultCheckpointPath,
  type ConnectorCheckpointStore
} from './checkpoints';
import { buildGlobRegex, delay } from './utils';

const ingestionDefinitionSchema = ingestionRequestSchema.extend({
  rows: ingestionRequestSchema.shape.rows.optional(),
  receivedAt: z.string().optional()
});

const bulkFileSchema = z.object({
  ingestion: ingestionDefinitionSchema,
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  chunkSize: z.number().int().positive().optional(),
  idempotencyBase: z.string().min(1).optional()
});

export type BulkConnectorDependencies = {
  queueDepthProvider?: () => Promise<number>;
  enqueue?: (payload: IngestionJobPayload) => Promise<void>;
};

interface BulkCheckpointState {
  processed: Record<string, string>;
}

const DEFAULT_BULK_CHECKPOINT_STATE: BulkCheckpointState = {
  processed: {}
};

export class BulkFileLoader {
  private readonly logger: FastifyBaseLogger;
  private readonly backpressure: BackpressureController;
  private readonly checkpointStore: ConnectorCheckpointStore<BulkCheckpointState>;
  private readonly queueDepthProvider: () => Promise<number>;
  private readonly enqueue: (payload: IngestionJobPayload) => Promise<unknown>;
  private readonly pattern: RegExp;
  private state: BulkCheckpointState = { ...DEFAULT_BULK_CHECKPOINT_STATE };
  private loop: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly config: BulkConnectorConfig,
    logger: FastifyBaseLogger,
    backpressureConfig: ConnectorBackpressureConfig,
    dependencies: BulkConnectorDependencies = {}
  ) {
    this.logger = logger;
    this.backpressure = new BackpressureController(backpressureConfig);
    const checkpointPath = config.checkpointPath
      ? config.checkpointPath
      : defaultCheckpointPath(config.directory, config.id, 'checkpoint.json');
    this.checkpointStore = new JsonFileCheckpointStore(checkpointPath);
    this.queueDepthProvider = dependencies.queueDepthProvider
      ? dependencies.queueDepthProvider
      : async () => getIngestionQueueDepth();
    this.enqueue = dependencies.enqueue
      ? dependencies.enqueue
      : async (payload) => {
          await enqueueIngestionJob(payload);
        };
    this.pattern = buildGlobRegex(config.filePattern);
  }

  async start(): Promise<void> {
    this.state = await this.checkpointStore.load(DEFAULT_BULK_CHECKPOINT_STATE);
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
          this.logger.debug({ connectorId: this.config.id, queueDepth: depth, delayMs: decision.delayMs }, 'bulk loader paused by backpressure');
          await delay(decision.delayMs);
          continue;
        }

        const processed = await this.processAvailableFiles();
        if (!processed) {
          await delay(this.config.pollIntervalMs);
        }
      } catch (error) {
        this.logger.error({ err: error, connectorId: this.config.id }, 'bulk loader iteration failed');
        await delay(Math.min(this.config.pollIntervalMs * 2, 10_000));
      }
    }
  }

  private async processAvailableFiles(): Promise<boolean> {
    const files = await this.listCandidateFiles();
    if (files.length === 0) {
      return false;
    }

    let processed = false;
    for (const fileName of files) {
      if (this.stopped) {
        break;
      }
      try {
        const success = await this.processFile(fileName);
        processed = processed || success;
      } catch (error) {
        this.logger.error({ err: error, connectorId: this.config.id, fileName }, 'bulk loader failed to process file');
      }
    }
    return processed;
  }

  private async listCandidateFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.config.directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => this.pattern.test(name))
        .filter((name) => !name.endsWith('.processed') && !name.endsWith('.failed'))
        .filter((name) => !(name in this.state.processed))
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return [];
      }
      this.logger.error({ err: error, connectorId: this.config.id }, 'bulk loader failed to list directory');
      return [];
    }
  }

  private async processFile(fileName: string): Promise<boolean> {
    const fullPath = path.join(this.config.directory, fileName);
    let fileContent: string;
    try {
      fileContent = await fs.readFile(fullPath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return false;
      }
      throw error;
    }

    let descriptor: z.infer<typeof bulkFileSchema>;
    try {
      descriptor = bulkFileSchema.parse(JSON.parse(fileContent) as unknown);
    } catch (error) {
      await this.writeDlq({
        reason: 'parse-error',
        error: error instanceof Error ? error.message : error,
        connectorId: this.config.id,
        fileName
      });
      await this.markFailure(fullPath, fileName, 'parse');
      return false;
    }

    const rows = descriptor.rows ?? descriptor.ingestion.rows ?? [];
    if (rows.length === 0) {
      await this.writeDlq({
        reason: 'no-rows',
        connectorId: this.config.id,
        fileName
      });
      await this.markFailure(fullPath, fileName, 'empty');
      return false;
    }

    const chunkSize = descriptor.chunkSize ?? this.config.chunkSize;
    const idempotencyBase = descriptor.ingestion.idempotencyKey
      ?? descriptor.idempotencyBase
      ?? `${this.config.id}:${fileName}`;

    const ingestionBase = { ...descriptor.ingestion } as Record<string, unknown>;
    delete ingestionBase.rows;
    const receivedAt = typeof descriptor.ingestion.receivedAt === 'string'
      ? descriptor.ingestion.receivedAt
      : new Date().toISOString();

    const totalChunks = Math.ceil(rows.length / chunkSize);
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      if (this.stopped) {
        break;
      }
      const chunk = rows.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
      if (chunk.length === 0) {
        continue;
      }
      const idempotencyKey = `${idempotencyBase}:${chunkIndex.toString().padStart(4, '0')}`;
      let payload: IngestionJobPayload;
      try {
        payload = ingestionJobPayloadSchema.parse({
          ...ingestionBase,
          rows: chunk,
          idempotencyKey,
          receivedAt
        });
      } catch (error) {
        await this.writeDlq({
          reason: 'validation-error',
          error: error instanceof Error ? error.message : error,
          connectorId: this.config.id,
          fileName,
          chunkIndex
        });
        await this.markFailure(fullPath, fileName, 'validation');
        return false;
      }

      try {
        await this.enqueueWithBackpressure(payload);
      } catch (error) {
        await this.writeDlq({
          reason: 'enqueue-error',
          error: error instanceof Error ? error.message : error,
          connectorId: this.config.id,
          fileName,
          chunkIndex
        });
        await this.markFailure(fullPath, fileName, 'enqueue');
        return false;
      }
    }

    await this.markSuccess(fullPath, fileName);
    return true;
  }

  private async markSuccess(fullPath: string, fileName: string): Promise<void> {
    try {
      if (this.config.deleteAfterLoad) {
        await fs.rm(fullPath);
      } else if (this.config.renameOnSuccess) {
        const target = `${fullPath}.processed`;
        await fs.rename(fullPath, target);
      }
    } catch (error) {
      this.logger.error({ err: error, connectorId: this.config.id, fileName }, 'bulk loader failed to archive processed file');
    }

    this.state.processed[fileName] = new Date().toISOString();
    await this.persistState();
  }

  private async markFailure(fullPath: string, fileName: string, reason: string): Promise<void> {
    try {
      const target = `${fullPath}.failed`; // ensure we do not overwrite existing
      await fs.rename(fullPath, target).catch(async (error) => {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          return;
        }
        throw error;
      });
    } catch (error) {
      this.logger.error({ err: error, connectorId: this.config.id, fileName, reason }, 'bulk loader failed to move failed file');
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
      this.logger.error({ err: error, connectorId: this.config.id }, 'bulk loader failed to write DLQ entry');
    }
  }

  private async persistState(): Promise<void> {
    try {
      await this.checkpointStore.save(this.state);
    } catch (error) {
      this.logger.error({ err: error, connectorId: this.config.id }, 'bulk loader failed to persist checkpoint');
    }
  }

  private async enqueueWithBackpressure(payload: IngestionJobPayload): Promise<void> {
    while (!this.stopped) {
      try {
        await this.enqueue(payload);
        return;
      } catch (error) {
        this.logger.warn(
          {
            connectorId: this.config.id,
            datasetSlug: payload.datasetSlug,
            error: error instanceof Error ? error.message : error
          },
          'ingestion queue unavailable; bulk loader backing off'
        );
        await delay(Math.max(50, this.config.pollIntervalMs));
      }
    }
    throw new Error('bulk loader stopped before enqueue completed');
  }
}
