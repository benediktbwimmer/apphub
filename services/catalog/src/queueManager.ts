import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

type QueueMode = 'inline' | 'queue';

type QueueTelemetryEvent = {
  type:
    | 'register'
    | 'mode-change'
    | 'queue-created'
    | 'queue-disposed'
    | 'worker-loaded'
    | 'metrics-error'
    | 'connection-error';
  queue: string;
  mode: QueueMode;
  meta?: Record<string, unknown>;
};

export type QueueTelemetryHandler = (event: QueueTelemetryEvent) => void;

export type QueueRegistration<TData = unknown> = {
  key: string;
  queueName: string;
  defaultJobOptions?: JobsOptions;
  workerLoader?: () => Promise<void>;
};

type QueueRegistrationInternal<TData = unknown> = QueueRegistration<TData> & {
  workerLoaded: boolean;
};

export type QueueManagerOptions = {
  telemetry?: QueueTelemetryHandler;
  createRedis?: (url: string) => Redis;
};

function normalize(value: string | undefined): string | undefined {
  return value ? value.trim() : undefined;
}

function isInlineValue(value: string | undefined): boolean {
  return normalize(value)?.toLowerCase() === 'inline';
}

function computeInlineMode(): boolean {
  return isInlineValue(process.env.REDIS_URL) || isInlineValue(process.env.APPHUB_EVENTS_MODE);
}

function resolveRedisUrl(): string {
  const normalized = normalize(process.env.REDIS_URL);
  if (isInlineValue(normalized)) {
    throw new Error('Redis URL requested while inline queue mode is active');
  }
  return normalized ?? 'redis://127.0.0.1:6379';
}

export class QueueManager {
  private inlineMode = computeInlineMode();
  private connection: Redis | null = null;
  private readonly registrations = new Map<string, QueueRegistrationInternal>();
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly options: QueueManagerOptions = {}) {}

  registerQueue<TData>(registration: QueueRegistration<TData>): void {
    if (this.registrations.has(registration.key)) {
      throw new Error(`Queue with key ${registration.key} is already registered`);
    }

    this.registrations.set(registration.key, {
      ...registration,
      workerLoaded: false
    });

    this.emit({
      type: 'register',
      queue: registration.queueName,
      mode: this.inlineMode ? 'inline' : 'queue'
    });

    this.ensureMode();
    if (!this.inlineMode) {
      this.ensureQueue(registration.key);
    }
  }

  async ensureWorker(key: string): Promise<void> {
    const registration = this.registrations.get(key);
    if (!registration || !registration.workerLoader) {
      return;
    }
    if (registration.workerLoaded) {
      return;
    }
    await registration.workerLoader();
    registration.workerLoaded = true;
    this.emit({
      type: 'worker-loaded',
      queue: registration.queueName,
      mode: this.inlineMode ? 'inline' : 'queue'
    });
  }

  isInlineMode(): boolean {
    this.ensureMode();
    return this.inlineMode;
  }

  getConnection(): Redis {
    this.ensureMode();
    if (this.inlineMode || !this.connection) {
      throw new Error('Redis connection not initialised');
    }
    return this.connection;
  }

  getQueue<TData>(key: string): Queue<TData> {
    this.ensureMode();
    if (this.inlineMode) {
      throw new Error('Queue unavailable in inline mode');
    }
    const queue = this.ensureQueue(key);
    if (!queue) {
      throw new Error(`Queue ${key} not initialised`);
    }
    return queue as Queue<TData>;
  }

  tryGetQueue<TData>(key: string): Queue<TData> | null {
    this.ensureMode();
    if (this.inlineMode) {
      return null;
    }
    return (this.ensureQueue(key) as Queue<TData> | null) ?? null;
  }

  async closeConnection(instance?: Redis | null): Promise<void> {
    const target = instance ?? this.connection;
    if (!target) {
      return;
    }

    if (isConnectionClosed(target)) {
      return;
    }

    try {
      await target.quit();
    } catch (err) {
      if (err instanceof Error && err.message.includes('Connection is closed')) {
        return;
      }
      throw err;
    } finally {
      if (!instance || target === this.connection) {
        this.disposeQueues();
        if (target === this.connection) {
          this.connection = null;
        }
      }
    }
  }

  async getQueueCounts(key: string): Promise<Record<string, number>> {
    const queue = this.tryGetQueue(key);
    if (!queue) {
      return {};
    }
    try {
      return await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    } catch (err) {
      this.emit({
        type: 'metrics-error',
        queue: queue.name,
        mode: 'queue',
        meta: { error: err instanceof Error ? err.message : String(err) }
      });
      return {};
    }
  }

  private ensureMode(): void {
    const desiredInline = computeInlineMode();
    if (desiredInline !== this.inlineMode) {
      this.inlineMode = desiredInline;
      this.emit({
        type: 'mode-change',
        queue: '*',
        mode: this.inlineMode ? 'inline' : 'queue'
      });
      this.disposeQueues();
      this.disposeConnection();
    }

    if (this.inlineMode) {
      return;
    }

    if (!this.connection) {
      this.connection = this.createConnection();
    }

    for (const key of this.registrations.keys()) {
      this.ensureQueue(key);
    }
  }

  private createConnection(): Redis {
    const redisUrl = resolveRedisUrl();
    const instance = this.options.createRedis ? this.options.createRedis(redisUrl) : new IORedis(redisUrl, { maxRetriesPerRequest: null });
    instance.on('error', (err) => {
      const meta = err instanceof Error ? { message: err.message } : { message: String(err) };
      this.emit({ type: 'connection-error', queue: '*', mode: 'queue', meta });
    });
    return instance;
  }

  private ensureQueue(key: string): Queue | null {
    if (this.queues.has(key)) {
      return this.queues.get(key) ?? null;
    }

    if (!this.connection) {
      return null;
    }

    const registration = this.registrations.get(key);
    if (!registration) {
      throw new Error(`Queue with key ${key} has not been registered`);
    }

    const queue = new Queue(registration.queueName, {
      connection: this.connection,
      defaultJobOptions: registration.defaultJobOptions
    });

    this.queues.set(key, queue);
    this.emit({ type: 'queue-created', queue: registration.queueName, mode: 'queue' });
    return queue;
  }

  private disposeQueues(): void {
    for (const [key, queue] of this.queues.entries()) {
      void queue.close().catch(() => {});
      this.emit({ type: 'queue-disposed', queue: queue.name, mode: 'queue', meta: { reason: 'dispose' } });
      this.queues.delete(key);
    }
  }

  private disposeConnection(): void {
    if (!this.connection) {
      return;
    }
    void this.connection.quit().catch(() => {});
    this.connection = null;
  }

  private emit(event: QueueTelemetryEvent): void {
    if (this.options.telemetry) {
      this.options.telemetry(event);
      return;
    }
    const payload = { queue: event.queue, mode: event.mode, ...event.meta };
    const details = Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : '';
    console.info(`[queue-manager] ${event.type}${details}`);
  }
}

function isConnectionClosed(instance: Redis): boolean {
  return instance.status === 'end' || instance.status === 'close';
}

export const queueManager = new QueueManager();
