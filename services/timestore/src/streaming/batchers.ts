import type { FastifyBaseLogger } from 'fastify';
import { Kafka, logLevel, type Consumer } from 'kafkajs';
import type { ServiceConfig, StreamingBatcherConfig } from '../config/serviceConfig';
import { StreamingBatchProcessor, type FlushReason } from './batchProcessor';
import {
  setStreamingBatcherMetrics,
  type StreamingBatcherMetric,
  type StreamingBatcherState
} from '../observability/metrics';

interface StreamingBatcherContext {
  config: StreamingBatcherConfig;
  processor: StreamingBatchProcessor;
  consumer: Consumer;
  logger: FastifyBaseLogger;
  state: StreamingBatcherState;
  lastMessageAtMs: number | null;
  lastError: string | null;
  runPromise?: Promise<void>;
}

export interface StreamingBatcherRuntimeStatus {
  connectorId: string;
  datasetSlug: string;
  topic: string;
  groupId: string;
  state: StreamingBatcherState;
  lastMessageAtMs: number | null;
  lastError: string | null;
  bufferedWindows: number;
  bufferedRows: number;
  openWindows: number;
  lastFlushAtMs: number | null;
  lastEventTimestampMs: number | null;
}

class StreamingMicroBatcher {
  private readonly context: StreamingBatcherContext;
  private readonly metricsCallback: () => void;

  constructor(
    kafka: Kafka,
    config: StreamingBatcherConfig,
    logger: FastifyBaseLogger,
    onMetricsUpdate?: () => void
  ) {
    const processorLogger = typeof logger.child === 'function'
      ? logger.child({ connectorId: config.id })
      : logger;

    const processor = new StreamingBatchProcessor(config, processorLogger);
    const consumer = kafka.consumer({ groupId: config.groupId });
    this.metricsCallback = typeof onMetricsUpdate === 'function' ? onMetricsUpdate : () => {};
    this.context = {
      config,
      processor,
      consumer,
      logger: processorLogger,
      state: 'starting',
      lastMessageAtMs: null,
      lastError: null
    };
  }

  async start(): Promise<void> {
    const { consumer, config, processor, logger } = this.context;
    await consumer.connect();
    await consumer.subscribe({ topic: config.topic, fromBeginning: config.startFromEarliest });

    this.context.state = 'running';
    this.context.lastError = null;
    this.metricsCallback();

    this.context.runPromise = consumer.run({
      eachMessage: async ({ partition, message }) => {
        if (!message.value) {
          logger.warn({ topic: config.topic, connectorId: config.id }, 'streaming message missing value');
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(message.value.toString('utf8'));
        } catch (error) {
          logger.warn({ err: error, connectorId: config.id }, 'streaming message failed JSON parse');
          return;
        }
        if (!payload || typeof payload !== 'object') {
          logger.warn({ connectorId: config.id }, 'streaming message payload is not an object; skipping');
          return;
        }
        try {
          const record = payload as Record<string, unknown>;
          record.kafkaPartition = partition.toString();
          const kafkaMessage = message as { offset?: string };
          if (kafkaMessage.offset !== undefined) {
            record.kafkaOffset = kafkaMessage.offset;
          }
          await processor.processRecord(payload as Record<string, unknown>);
          this.context.lastMessageAtMs = Date.now();
          this.metricsCallback();
        } catch (error) {
          logger.error({ err: error, connectorId: config.id }, 'streaming batch processor failed');
          throw error;
        }
      }
    }).catch((error) => {
      this.context.state = 'error';
      this.context.lastError = error instanceof Error ? error.message : String(error);
      this.metricsCallback();
      logger.error({ err: error, connectorId: config.id }, 'streaming consumer terminated unexpectedly');
    });

    logger.info({ connectorId: config.id, topic: config.topic, groupId: config.groupId }, 'streaming micro-batcher started');
  }

  async stop(reason: FlushReason = 'shutdown'): Promise<void> {
    const { consumer, processor, logger, config } = this.context;
    try {
      await consumer.stop();
    } catch (error) {
      logger.warn({ err: error, connectorId: config.id }, 'streaming consumer stop failed');
    }
    if (this.context.runPromise) {
      await this.context.runPromise.catch(() => undefined);
    }
    await processor.flushAll(reason);
    try {
      await consumer.disconnect();
    } catch (error) {
      logger.warn({ err: error, connectorId: config.id }, 'streaming consumer disconnect failed');
    }
    this.context.state = 'stopped';
    this.metricsCallback();
    logger.info({ connectorId: config.id }, 'streaming micro-batcher stopped');
  }

  getMetric(): StreamingBatcherMetric {
    const diagnostics = this.context.processor.getDiagnostics();
    return {
      datasetSlug: this.context.config.datasetSlug,
      connectorId: this.context.config.id,
      buffers: diagnostics.bufferedWindows,
      state: this.context.state
    } satisfies StreamingBatcherMetric;
  }

  getStatus(): StreamingBatcherRuntimeStatus {
    const diagnostics = this.context.processor.getDiagnostics();
    return {
      connectorId: this.context.config.id,
      datasetSlug: this.context.config.datasetSlug,
      topic: this.context.config.topic,
      groupId: this.context.config.groupId,
      state: this.context.state,
      lastMessageAtMs: this.context.lastMessageAtMs,
      lastError: this.context.lastError,
      bufferedWindows: diagnostics.bufferedWindows,
      bufferedRows: diagnostics.bufferedRows,
      openWindows: diagnostics.openWindows,
      lastFlushAtMs: diagnostics.lastFlushAtMs,
      lastEventTimestampMs: diagnostics.lastEventTimestampMs
    } satisfies StreamingBatcherRuntimeStatus;
  }
}

class StreamingBatcherManager {
  private readonly kafka: Kafka;
  private readonly batchers: StreamingMicroBatcher[] = [];
  private metricsTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly brokerUrl: string,
    private readonly batcherConfigs: StreamingBatcherConfig[],
    private readonly logger: FastifyBaseLogger
  ) {
    this.kafka = new Kafka({
      clientId: 'timestore-streaming-batcher',
      brokers: [brokerUrl],
      logLevel: logLevel.ERROR
    });
  }

  async start(): Promise<void> {
    const baseLogger = typeof this.logger.child === 'function'
      ? this.logger.child({ component: 'timestore.streaming.batchers' })
      : this.logger;

    for (const config of this.batcherConfigs) {
      const connectorLogger = typeof baseLogger.child === 'function'
        ? baseLogger.child({ connectorId: config.id })
        : baseLogger;
      const batcher = new StreamingMicroBatcher(this.kafka, config, connectorLogger, () => {
        this.publishMetrics();
      });
      await batcher.start();
      this.batchers.push(batcher);
    }

    this.publishMetrics();
    if (this.batchers.length === 0) {
      return;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    this.metricsTimer = setInterval(() => {
      this.publishMetrics();
    }, 5_000);
    if (this.metricsTimer && typeof this.metricsTimer.unref === 'function') {
      this.metricsTimer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    const stops = this.batchers.map((batcher) => batcher.stop().catch((error) => {
      this.logger.error({ err: error }, 'failed to stop streaming micro-batcher');
    }));
    await Promise.allSettled(stops);
    this.batchers.length = 0;
    this.publishMetrics();
  }

  getMetrics(): StreamingBatcherMetric[] {
    return this.batchers.map((batcher) => batcher.getMetric());
  }

  getStatus(): StreamingBatcherRuntimeStatus[] {
    return this.batchers.map((batcher) => batcher.getStatus());
  }

  private publishMetrics(): void {
    try {
      const metrics = this.getMetrics();
      setStreamingBatcherMetrics(metrics);
    } catch (error) {
      this.logger.debug({ err: error }, 'failed to publish streaming batcher metrics');
    }
  }
}

let manager: StreamingBatcherManager | null = null;

export async function initializeStreamingBatchers(
  params: { config: ServiceConfig; logger: FastifyBaseLogger }
): Promise<void> {
  if (manager) {
    await manager.stop().catch(() => undefined);
    manager = null;
  }

  const streamingFeatureEnabled = params.config.features.streaming.enabled;
  const brokerUrl = params.config.streaming.brokerUrl;
  const batcherConfigs = params.config.streaming.batchers;

  if (!streamingFeatureEnabled) {
    setStreamingBatcherMetrics([]);
    return;
  }
  if (!brokerUrl) {
    const warnLogger = typeof params.logger.child === 'function'
      ? params.logger.child({ component: 'timestore.streaming.batchers' })
      : params.logger;
    warnLogger.warn('streaming enabled but APPHUB_STREAM_BROKER_URL is not configured; skipping micro-batchers');
    setStreamingBatcherMetrics([]);
    return;
  }
  if (batcherConfigs.length === 0) {
    setStreamingBatcherMetrics([]);
    return;
  }

  manager = new StreamingBatcherManager(brokerUrl, batcherConfigs, params.logger);
  await manager.start();
}

export async function shutdownStreamingBatchers(): Promise<void> {
  if (!manager) {
    setStreamingBatcherMetrics([]);
    return;
  }
  const instance = manager;
  manager = null;
  await instance.stop();
  setStreamingBatcherMetrics([]);
}

export function getStreamingBatcherStatus(): StreamingBatcherRuntimeStatus[] {
  if (!manager) {
    return [];
  }
  return manager.getStatus();
}

export { StreamingBatchProcessor } from './batchProcessor';
