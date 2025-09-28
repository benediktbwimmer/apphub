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
  private workerConnection: Redis | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(options: RollupQueueOptions, processor: RollupJobProcessor) {
    this.options = options;
    this.processor = processor;
  }

  private async ensureQueue(): Promise<void> {
    if (this.options.inlineMode) {
      return;
    }

    if (this.queue) {
      return;
    }

    if (!this.readyPromise) {
      this.readyPromise = this.createQueue();
    }

    await this.readyPromise;
  }

  private async createQueue(): Promise<void> {
    const connection = new IORedis(this.options.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true
    });

    connection.on('error', (err) => {
      console.error('[filestore:rollup-queue] Redis connection error', err);
    });

    let workerConnection: Redis | null = null;
    let worker: Worker<RollupJobPayload> | null = null;
    let queue: BullQueue<RollupJobPayload> | null = null;

    try {
      if (connection.status === 'wait') {
        await connection.connect();
      }
      await connection.ping();

      queue = new Queue<RollupJobPayload>(this.options.queueName, {
        connection,
        prefix: `${this.options.keyPrefix}:bull`
      });

      workerConnection = connection.duplicate();
      if (workerConnection.status === 'wait') {
        await workerConnection.connect();
      }

      worker = new Worker<RollupJobPayload>(
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

      worker.on('error', (err) => {
        console.error('[filestore:rollup-queue] Worker error', err);
      });

      await worker.waitUntilReady();

      this.connection = connection;
      this.queue = queue;
      this.worker = worker;
      this.workerConnection = workerConnection;
    } catch (err) {
      if (worker) {
        try {
          await worker.close();
        } catch {
          // ignore close errors during init failure
        }
      }
      if (queue) {
        try {
          await queue.close();
        } catch {
          // ignore close errors during init failure
        }
      }
      if (workerConnection) {
        try {
          await workerConnection.quit();
        } catch {
          // ignore close errors during init failure
        }
      }
      connection.removeAllListeners();
      try {
        await connection.quit();
      } catch {
        // ignore close errors during init failure
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async ensureReady(): Promise<void> {
    await this.ensureQueue();
  }

  async enqueue(payload: RollupJobPayload): Promise<void> {
    if (this.options.inlineMode) {
      await this.processor(payload);
      this.options.metrics.recordRecalculation(payload.reason);
      this.options.metrics.updateQueueDepth({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 });
      return;
    }

    await this.ensureQueue();

    if (!this.queue) {
      throw new Error('Rollup queue not initialised');
    }

    await this.queue.add(payload.reason, payload, {
      jobId: `rollup-${payload.nodeId}`,
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

    if (this.workerConnection) {
      try {
        await this.workerConnection.quit();
      } catch (err) {
        console.error('[filestore:rollup-queue] failed to close worker redis connection', err);
      }
      this.workerConnection = null;
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

    this.readyPromise = null;
  }
}
