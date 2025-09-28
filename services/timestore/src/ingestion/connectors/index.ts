import type { FastifyBaseLogger } from 'fastify';
import type { ServiceConfig } from '../../config/serviceConfig';
import { FileStreamingConnector, type StreamingConnectorDependencies } from './streamingFileConnector';
import { BulkFileLoader, type BulkConnectorDependencies } from './bulkFileLoader';

interface ConnectorManagerDependencies extends StreamingConnectorDependencies, BulkConnectorDependencies {}

interface ConnectorLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

let manager: { stop: () => Promise<void> } | null = null;

export async function initializeIngestionConnectors(
  params: { config: ServiceConfig; logger: FastifyBaseLogger },
  dependencies: ConnectorManagerDependencies = {}
): Promise<void> {
  if (manager) {
    await manager.stop().catch(() => undefined);
    manager = null;
  }

  const connectorsConfig = params.config.ingestion?.connectors;
  if (!connectorsConfig || !connectorsConfig.enabled) {
    return;
  }

  const connectors: ConnectorLifecycle[] = [];
  const baseLogger = typeof params.logger.child === 'function'
    ? params.logger.child({ component: 'timestore.connectors' })
    : params.logger;

  for (const streamingConfig of connectorsConfig.streaming) {
    const connector = new FileStreamingConnector(
      streamingConfig,
      baseLogger,
      connectorsConfig.backpressure,
      dependencies
    );
    connectors.push(connector);
  }

  for (const bulkConfig of connectorsConfig.bulk) {
    const connector = new BulkFileLoader(
      bulkConfig,
      baseLogger,
      connectorsConfig.backpressure,
      dependencies
    );
    connectors.push(connector);
  }

  if (connectors.length === 0) {
    return;
  }

  await Promise.all(connectors.map((connector) => connector.start()));

  manager = {
    stop: async () => {
      await Promise.allSettled(connectors.map((connector) => connector.stop()));
    }
  };
}

export async function shutdownIngestionConnectors(): Promise<void> {
  if (!manager) {
    return;
  }
  const current = manager;
  manager = null;
  await current.stop();
}
