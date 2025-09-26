import { Queue, Worker, type Queue as BullQueue, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { RollupMetrics } from './metrics';

export type RollupJobReason = 'mutation' | 'manual' | 'pending-refresh';

export interface RollupJobPayload {
  nodeId: number;
  backendMountId: number;
  reason: RollupJobReason;
  depth?: number;
}

export interface RollupQueueOptions {
  queueName: string;
  redisUrl: string;
  inlineMode: boolean;
  metrics: RollupMetrics;
  keyPrefix: string;
  concurrency?: number;
}

type RollupJobProcessor = (payload: RollupJobPayload) => Promise<void>;

export class RollupQueue {
  private readonly options: RollupQueueOptions;
  private readonly processor: RollupJobProcessor;
  private connection: Redis | null = null;
  private queue: BullQueue<RollupJobPayload> | null = null;
  private worker: Worker<RollupJobPayload> | null = null;

  constructor(options: RollupQueueOptions, processor: RollupJobProcessor) {
    this.options = options;
    this.processor = processor;

    if (!options.inlineMode) {
      this.initializeQueue();
    }
  }

  private initializeQueue(): void {
    if (this.queue) {
      return;
    }

    this.connection = new IORedis(this.options.redisUrl, {
      maxRetriesPerRequest: null
    });
    this.connection.on('error', (err) => {
      console.error('[filestore:rollup-queue] Redis connection error', err);
    });

    this.queue = new Queue<RollupJobPayload>(this.options.queueName, {
      connection: this.connection,
      prefix: `${this.options.keyPrefix}:bull`
    });

    const workerConnection = this.connection.duplicate();
    this.worker = new Worker<RollupJobPayload>(
      this.options.queueName,
      async (job: Job<RollupJobPayload>) => {
        await this.processor(job.data);
        this.options.metrics.recordRecalculation(job.data.reason);
        void this.refreshQueueDepth();
      },
      {
        connection: workerConnection,
        concurrency: this.options.concurrency ?? 1,
        prefix: `${this.options.keyPrefix}:bull`
      }
    );

    this.worker.on('error', (err) => {
      console.error('[filestore:rollup-queue] Worker error', err);
    });
  }

  async enqueue(payload: RollupJobPayload): Promise<void> {
    if (this.options.inlineMode) {
      await this.processor(payload);
      this.options.metrics.recordRecalculation(payload.reason);
      this.options.metrics.updateQueueDepth({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 });
      return;
    }

    if (!this.queue) {
      this.initializeQueue();
    }

    if (!this.queue) {
      throw new Error('Rollup queue not initialised');
    }

    await this.queue.add(payload.reason, payload, {
      jobId: `rollup:${payload.nodeId}`,
      removeOnComplete: true,
      removeOnFail: false
    });

    await this.refreshQueueDepth();
  }

  private async refreshQueueDepth(): Promise<void> {
    if (!this.queue) {
      this.options.metrics.updateQueueDepth({});
      return;
    }

    try {
      const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      this.options.metrics.updateQueueDepth(counts);
    } catch (err) {
      console.warn('[filestore:rollup-queue] failed to fetch job counts', err);
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        console.error('[filestore:rollup-queue] failed to close worker', err);
      }
      this.worker = null;
    }

    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        console.error('[filestore:rollup-queue] failed to close queue', err);
      }
      this.queue = null;
    }

    if (this.connection) {
      try {
        await this.connection.quit();
      } catch (err) {
        console.error('[filestore:rollup-queue] failed to close redis connection', err);
      }
      this.connection = null;
    }
  }
}
