import Fastify from 'fastify';
import { loadObservatoryConfig } from '@observatory/shared-config';
import type { FilestoreEvent } from '@apphub/shared/filestoreEvents';
import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';

const PORT = Number.parseInt(process.env.PORT ?? '4310', 10) || 4310;
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_RECENT_EVENTS = 50;

type EventSnapshot = {
  type: FilestoreEvent['type'];
  path: string;
  observedAt: string;
  metadata?: Record<string, unknown>;
};

type MetricsState = {
  startedAt: string;
  uploads: number;
  moves: number;
  archives: number;
  lastUpload?: EventSnapshot;
  lastArchive?: EventSnapshot;
  streamConnected: boolean;
  streamLastError?: string | null;
};

function redactConfig(config: ReturnType<typeof loadObservatoryConfig>) {
  return {
    paths: config.paths,
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      inboxPrefix: config.filestore.inboxPrefix,
      stagingPrefix: config.filestore.stagingPrefix,
      archivePrefix: config.filestore.archivePrefix
    },
    timestore: config.timestore,
    metastore: config.metastore,
    catalog: config.catalog,
    workflows: config.workflows
  };
}

async function streamFilestoreEvents(
  client: FilestoreClient,
  metrics: MetricsState,
  recentEvents: EventSnapshot[]
): Promise<void> {
  try {
    for await (const event of client.streamEvents({
      eventTypes: [
        'filestore.node.uploaded',
        'filestore.node.moved',
        'filestore.node.copied',
        'filestore.node.updated'
      ]
    })) {
      metrics.streamConnected = true;
      metrics.streamLastError = null;
      const snapshot: EventSnapshot = {
        type: event.type,
        path:
          typeof event.data === 'object' && event.data && 'path' in event.data
            ? String((event.data as Record<string, unknown>).path ?? '')
            : '',
        observedAt:
          typeof event.data === 'object' && event.data && 'observedAt' in event.data
            ? String((event.data as Record<string, unknown>).observedAt ?? new Date().toISOString())
            : new Date().toISOString(),
        metadata:
          typeof event.data === 'object' && event.data && 'metadata' in event.data
            ? ((event.data as Record<string, unknown>).metadata as Record<string, unknown>)
            : undefined
      };

      recentEvents.unshift(snapshot);
      if (recentEvents.length > MAX_RECENT_EVENTS) {
        recentEvents.length = MAX_RECENT_EVENTS;
      }

      switch (event.type) {
        case 'filestore.node.uploaded':
          metrics.uploads += 1;
          metrics.lastUpload = snapshot;
          break;
        case 'filestore.node.moved':
          metrics.moves += 1;
          metrics.lastArchive = snapshot;
          break;
        case 'filestore.node.copied':
          // fall through for archive counting
          metrics.archives += 1;
          break;
        default:
          break;
      }
    }
  } catch (error) {
    metrics.streamConnected = false;
    metrics.streamLastError = error instanceof Error ? error.message : String(error);
    if (error instanceof FilestoreClientError) {
      console.error('[observatory] filestore stream error', error.statusCode, error.code, error.message);
    } else {
      console.error('[observatory] filestore stream error', error);
    }
    setTimeout(() => {
      void streamFilestoreEvents(client, metrics, recentEvents);
    }, 5000);
  }
}

async function main(): Promise<void> {
  const config = loadObservatoryConfig();
  const filestoreClient = new FilestoreClient({
    baseUrl: config.filestore.baseUrl,
    token: config.filestore.token,
    userAgent: 'observatory-event-gateway/0.2.0'
  });

  const metrics: MetricsState = {
    startedAt: new Date().toISOString(),
    uploads: 0,
    moves: 0,
    archives: 0,
    streamConnected: false
  };
  const recentEvents: EventSnapshot[] = [];

  void streamFilestoreEvents(filestoreClient, metrics, recentEvents);

  const app = Fastify({ logger: true });

  app.get('/healthz', async () => ({ status: 'ok', streamConnected: metrics.streamConnected }));

  app.get('/status', async () => ({
    config: redactConfig(config),
    metrics,
    recentEvents
  }));

  app.get('/config', async () => redactConfig(config));

  await app.listen({ port: PORT, host: HOST });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
