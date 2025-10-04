import type { FastifyBaseLogger } from 'fastify';
import { Kafka, logLevel, type Consumer } from 'kafkajs';
import type { ServiceConfig, StreamingBatcherConfig } from '../config/serviceConfig';
import { StreamingBatchProcessor, type FlushReason } from './batchProcessor';

interface StreamingBatcherContext {
  config: StreamingBatcherConfig;
  processor: StreamingBatchProcessor;
  consumer: Consumer;
  logger: FastifyBaseLogger;
  runPromise?: Promise<void>;
}

class StreamingMicroBatcher {
  private readonly context: StreamingBatcherContext;

  constructor(
    kafka: Kafka,
    config: StreamingBatcherConfig,
    logger: FastifyBaseLogger
  ) {
    const processorLogger = typeof logger.child === 'function'
      ? logger.child({ connectorId: config.id })
      : logger;

    const processor = new StreamingBatchProcessor(config, processorLogger);
    const consumer = kafka.consumer({ groupId: config.groupId });

    this.context = {
      config,
      processor,
      consumer,
      logger: processorLogger
    };
  }

  async start(): Promise<void> {
    const { consumer, config, processor, logger } = this.context;
    await consumer.connect();
    await consumer.subscribe({ topic: config.topic, fromBeginning: config.startFromEarliest });

    this.context.runPromise = consumer.run({
      eachMessage: async ({ message }) => {
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
          await processor.processRecord(payload as Record<string, unknown>);
        } catch (error) {
          logger.error({ err: error, connectorId: config.id }, 'streaming batch processor failed');
          throw error;
        }
      }
    }).catch((error) => {
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
    logger.info({ connectorId: config.id }, 'streaming micro-batcher stopped');
  }
}

class StreamingBatcherManager {
  private readonly kafka: Kafka;
  private readonly batchers: StreamingMicroBatcher[] = [];

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
      const batcher = new StreamingMicroBatcher(this.kafka, config, connectorLogger);
      await batcher.start();
      this.batchers.push(batcher);
    }
  }

  async stop(): Promise<void> {
    const stops = this.batchers.map((batcher) => batcher.stop().catch((error) => {
      this.logger.error({ err: error }, 'failed to stop streaming micro-batcher');
    }));
    await Promise.allSettled(stops);
    this.batchers.length = 0;
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
    return;
  }
  if (!brokerUrl) {
    const warnLogger = typeof params.logger.child === 'function'
      ? params.logger.child({ component: 'timestore.streaming.batchers' })
      : params.logger;
    warnLogger.warn('streaming enabled but APPHUB_STREAM_BROKER_URL is not configured; skipping micro-batchers');
    return;
  }
  if (batcherConfigs.length === 0) {
    return;
  }

  manager = new StreamingBatcherManager(brokerUrl, batcherConfigs, params.logger);
  await manager.start();
}

export async function shutdownStreamingBatchers(): Promise<void> {
  if (!manager) {
    return;
  }
  const instance = manager;
  manager = null;
  await instance.stop();
}

export { StreamingBatchProcessor } from './batchProcessor';
