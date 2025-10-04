import { Kafka, logLevel, CompressionTypes, type Producer, type IHeaders } from 'kafkajs';
import type { FastifyBaseLogger } from 'fastify';
import { recordMirrorPublish } from '../observability/streamingPublisherMetrics';

export interface KafkaMirrorMessage {
  topic: string;
  key?: string;
  value: string | Buffer | Record<string, unknown>;
  headers?: Record<string, string>;
  timestamp?: number | Date;
  partition?: number;
}

export interface KafkaPublisherOptions {
  connectTimeoutMs?: number;
  publishTimeoutMs?: number;
}

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error' | 'debug'>;

type MirrorDiagnostics = {
  topic: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError?: string | null;
};

const DEFAULT_PUBLISH_TIMEOUT_MS = Number(process.env.APPHUB_STREAM_PUBLISH_TIMEOUT_MS ?? 10_000);
const DEFAULT_CONNECT_TIMEOUT_MS = Number(process.env.APPHUB_STREAM_CONNECT_TIMEOUT_MS ?? 5_000);

let kafka: Kafka | null = null;
let producer: Producer | null = null;
let connectPromise: Promise<void> | null = null;
let shutdownHookRegistered = false;
let configuredLogger: Logger = console;
let kafkaProducerOptions: KafkaPublisherOptions = {
  connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
  publishTimeoutMs: DEFAULT_PUBLISH_TIMEOUT_MS
};

const diagnostics = new Map<string, MirrorDiagnostics>();

function getBrokerList(): string[] {
  const raw = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim();
  if (!raw) {
    return [];
  }
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function registerShutdownHook(): void {
  if (shutdownHookRegistered) {
    return;
  }
  shutdownHookRegistered = true;
  process.once('beforeExit', () => {
    void shutdownKafkaPublisher();
  });
}

function normalizeHeaders(headers: Record<string, string> | undefined): IHeaders | undefined {
  if (!headers) {
    return undefined;
  }
  const entries = Object.entries(headers).filter(([_, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return undefined;
  }
  const result: IHeaders = {};
  for (const [key, value] of entries) {
    result[key] = Buffer.from(String(value));
  }
  return result;
}

function normalizeValue(value: KafkaMirrorMessage['value']): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function updateDiagnostics(topic: string, result: 'success' | 'failure', error?: unknown): void {
  const entry = diagnostics.get(topic) ?? {
    topic,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    lastError: null
  };

  if (result === 'success') {
    entry.lastSuccessAt = new Date().toISOString();
    entry.failureCount = 0;
    entry.lastError = null;
  } else {
    entry.lastFailureAt = new Date().toISOString();
    entry.failureCount += 1;
    entry.lastError = error instanceof Error ? error.message : String(error ?? 'unknown error');
  }
  diagnostics.set(topic, entry);
}

async function ensureProducer(options: KafkaPublisherOptions = kafkaProducerOptions): Promise<Producer | null> {
  if (producer) {
    return producer;
  }

  const brokers = getBrokerList();
  if (brokers.length === 0) {
    return null;
  }

  if (!connectPromise) {
    const clientId = process.env.APPHUB_STREAM_CLIENT_ID?.trim() || 'apphub-core-stream';
    kafka = new Kafka({
      clientId,
      brokers,
      requestTimeout: options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS,
      connectionTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      logLevel: logLevel.ERROR
    });

    const instance = kafka.producer({
      allowAutoTopicCreation: false,
      idempotent: true,
      retry: {
        retries: 5
      }
    });

    connectPromise = instance
      .connect()
      .then(() => {
        producer = instance;
        const logger = configuredLogger;
        logger.info({ brokers }, 'Kafka streaming publisher connected');
        registerShutdownHook();
      })
      .catch(async (err) => {
        configuredLogger.error({ err }, 'Kafka streaming publisher failed to connect');
        try {
          await instance.disconnect();
        } catch {
          // ignore cleanup errors
        }
        producer = null;
        throw err;
      })
      .finally(() => {
        connectPromise = null;
      });
  }

  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  const promise = connectPromise;
  if (!promise) {
    return producer;
  }

  if (timeoutMs > 0) {
    try {
      await Promise.race([
        promise,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out connecting to Kafka broker')), timeoutMs);
        })
      ]);
    } catch (err) {
      configuredLogger.error({ err }, 'Kafka streaming publisher connection timed out');
      return producer;
    }
  } else {
    await promise;
  }

  return producer;
}

export function configureKafkaPublisher(options: {
  logger?: FastifyBaseLogger;
  connectTimeoutMs?: number;
  publishTimeoutMs?: number;
} = {}): void {
  if (options.logger) {
    const candidate = typeof options.logger.child === 'function'
      ? options.logger.child({ component: 'streaming.kafkaPublisher' })
      : options.logger;
    configuredLogger = candidate;
  }
  kafkaProducerOptions = {
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    publishTimeoutMs: options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS
  };
}

export async function verifyKafkaConnectivity(options: KafkaPublisherOptions = {}): Promise<void> {
  const producerInstance = await ensureProducer({
    connectTimeoutMs: options.connectTimeoutMs ?? kafkaProducerOptions.connectTimeoutMs,
    publishTimeoutMs: options.publishTimeoutMs ?? kafkaProducerOptions.publishTimeoutMs
  });
  if (!producerInstance) {
    throw new Error('Kafka streaming publisher is not configured');
  }
}

export async function publishKafkaMirrorMessage(
  message: KafkaMirrorMessage,
  options: KafkaPublisherOptions = {}
): Promise<boolean> {
  const producerInstance = await ensureProducer({
    connectTimeoutMs: options.connectTimeoutMs ?? kafkaProducerOptions.connectTimeoutMs,
    publishTimeoutMs: options.publishTimeoutMs ?? kafkaProducerOptions.publishTimeoutMs
  });

  if (!producerInstance) {
    configuredLogger.debug({ topic: message.topic }, 'Kafka streaming publisher skipped (not configured)');
    return false;
  }

  const start = Date.now();
  const timeoutMs = options.publishTimeoutMs ?? kafkaProducerOptions.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;

  try {
    await producerInstance.send({
      topic: message.topic,
      acks: -1,
      timeout: timeoutMs,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: message.key,
          value: normalizeValue(message.value),
          headers: normalizeHeaders(message.headers),
          timestamp:
            message.timestamp instanceof Date
              ? message.timestamp.getTime().toString()
              : typeof message.timestamp === 'number'
                ? message.timestamp.toString()
                : undefined,
          partition: message.partition
        }
      ]
    });
    const durationMs = Date.now() - start;
    recordMirrorPublish(message.topic, 'success', durationMs);
    updateDiagnostics(message.topic, 'success');
    configuredLogger.debug({ topic: message.topic, durationMs }, 'Mirrored event to Kafka');
    return true;
  } catch (err) {
    const durationMs = Date.now() - start;
    recordMirrorPublish(message.topic, 'failure', durationMs);
    updateDiagnostics(message.topic, 'failure', err);
    configuredLogger.error({ err, topic: message.topic }, 'Kafka streaming publish failed');
    return false;
  }
}

export function getMirrorDiagnostics(): Record<string, MirrorDiagnostics> {
  return Object.fromEntries(diagnostics.entries());
}

export async function shutdownKafkaPublisher(): Promise<void> {
  if (producer) {
    try {
      await producer.disconnect();
    } catch (err) {
      configuredLogger.warn({ err }, 'Kafka streaming publisher disconnect failed');
    }
    producer = null;
  }
  kafka = null;
}

export function isKafkaPublisherConfigured(): boolean {
  return getBrokerList().length > 0;
}
