import { Queue, Worker, type Job, type Queue as BullQueue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { ReconciliationMetrics } from './metrics';
import type { ReconciliationJobPayload } from './types';

export interface ReconciliationQueueOptions {
  queueName: string;
  redisUrl: string;
  inlineMode: boolean;
  metrics: ReconciliationMetrics;
  keyPrefix: string;
  concurrency?: number;
}

type ReconciliationJobProcessor = (payload: ReconciliationJobPayload) => Promise<void>;

type QueueCounts = Partial<Record<'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused', number>>;

export class ReconciliationQueue {
  private readonly options: ReconciliationQueueOptions;
  private readonly processor: ReconciliationJobProcessor;
  private connection: Redis | null = null;
  private queue: BullQueue<ReconciliationJobPayload> | null = null;
  private worker: Worker<ReconciliationJobPayload> | null = null;

  constructor(options: ReconciliationQueueOptions, processor: ReconciliationJobProcessor) {
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
      console.error('[filestore:reconcile-queue] Redis connection error', err);
    });

    this.queue = new Queue<ReconciliationJobPayload>(this.options.queueName, {
      connection: this.connection,
      prefix: `${this.options.keyPrefix}:bull`
    });

    const workerConnection = this.connection.duplicate();
    this.worker = new Worker<ReconciliationJobPayload>(
      this.options.queueName,
      async (job: Job<ReconciliationJobPayload>) => {
        await this.processor(job.data);
        void this.refreshQueueDepth();
      },
      {
        connection: workerConnection,
        concurrency: this.options.concurrency ?? 1,
        prefix: `${this.options.keyPrefix}:bull`
      }
    );

    this.worker.on('error', (err) => {
      console.error('[filestore:reconcile-queue] Worker error', err);
    });
  }

  async enqueue(payload: ReconciliationJobPayload, options: { jobId?: string } = {}): Promise<void> {
    if (this.options.inlineMode) {
      await this.processor(payload);
      this.options.metrics.recordQueueDepth({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 });
      return;
    }

    if (!this.queue) {
      this.initializeQueue();
    }

    if (!this.queue) {
      throw new Error('Reconciliation queue not initialised');
    }

    await this.queue.add(payload.reason, payload, {
      jobId: options.jobId,
      removeOnComplete: true,
      removeOnFail: false
    });

    await this.refreshQueueDepth();
  }

  private async refreshQueueDepth(): Promise<void> {
    const counts: QueueCounts = {};
    if (!this.queue) {
      this.options.metrics.recordQueueDepth(counts);
      return;
    }

    try {
      const jobCounts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      Object.assign(counts, jobCounts);
    } catch (err) {
      console.warn('[filestore:reconcile-queue] failed to fetch job counts', err);
    }

    this.options.metrics.recordQueueDepth(counts);
  }

  async close(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        console.error('[filestore:reconcile-queue] failed to close worker', err);
      }
      this.worker = null;
    }

    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        console.error('[filestore:reconcile-queue] failed to close queue', err);
      }
      this.queue = null;
    }

    if (this.connection) {
      try {
        await this.connection.quit();
      } catch (err) {
        console.error('[filestore:reconcile-queue] failed to close redis connection', err);
      }
      this.connection = null;
    }
  }
}
