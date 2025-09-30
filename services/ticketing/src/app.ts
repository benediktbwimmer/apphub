import { join } from 'node:path';
import { existsSync } from 'node:fs';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import chokidar from 'chokidar';
import fastify, { type FastifyInstance } from 'fastify';

import { TicketStore } from '@apphub/ticketing';

import { createLogger } from './logger';
import { createMetrics } from './metrics';
import { registerHealthRoutes } from './routes/health';
import { registerTicketRoutes } from './routes/tickets';
import { registerEventRoutes } from './routes/events';
import { mapErrorToResponse } from './errors';
import type { AppContext } from './types';
import type { TicketingConfig } from './config';

interface CreateAppResult {
  app: FastifyInstance;
  ctx: AppContext;
}

export const createApp = async (config: TicketingConfig): Promise<CreateAppResult> => {
  const logger = createLogger(config.logLevel);
  const app = fastify({ logger });
  await app.register(cors, { origin: true, credentials: true });

  const metrics = createMetrics();
  metrics.readinessGauge.set({ component: 'store' }, 0);
  metrics.readinessGauge.set({ component: 'watcher' }, config.enableWatcher ? 0 : 1);

  const store = new TicketStore({ rootDir: config.ticketsDir });
  const readiness = {
    store: false,
    watcher: !config.enableWatcher
  };

  await store.init();
  readiness.store = true;
  metrics.readinessGauge.set({ component: 'store' }, 1);

  const ctx: AppContext = {
    config,
    store,
    metrics,
    readiness
  };

  let watcher: chokidar.FSWatcher | undefined;
  if (config.enableWatcher) {
    const databasePath = store.getDatabasePath();
    watcher = chokidar.watch(databasePath, {
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      }
    });

    const triggerRefresh = (reason: string) => {
      ctx.metrics.ticketRefreshes.inc({ reason });
      store.refreshFromDisk().catch((error) => {
        app.log.error({ err: error, reason }, 'Failed to refresh tickets from storage');
      });
    };

    watcher.on('ready', () => {
      readiness.watcher = true;
      metrics.readinessGauge.set({ component: 'watcher' }, 1);
      app.log.info({ databasePath }, 'Ticket database watcher ready');
    });

    watcher.on('add', (filePath) => {
      app.log.debug({ filePath }, 'Ticket database created');
      triggerRefresh('add');
    });

    watcher.on('change', (filePath) => {
      app.log.debug({ filePath }, 'Ticket database changed');
      triggerRefresh('change');
    });

    watcher.on('unlink', (filePath) => {
      app.log.debug({ filePath }, 'Ticket database removed');
      triggerRefresh('unlink');
    });

    watcher.on('error', (error) => {
      app.log.error({ err: error }, 'Ticket watcher error');
      readiness.watcher = false;
      metrics.readinessGauge.set({ component: 'watcher' }, 0);
    });
  }

  registerHealthRoutes(app, ctx);
  registerTicketRoutes(app, ctx);
  const uiDir = join(__dirname, '..', 'ui', 'dist');
  if (existsSync(uiDir)) {
    await app.register(fastifyStatic, {
      root: uiDir,
      prefix: '/',
      decorateReply: false,
      wildcard: false
    });

    app.get('/*', async (request, reply) => {
      if (request.url.startsWith('/tickets') || request.url.startsWith('/metrics') || request.url.startsWith('/healthz') || request.url.startsWith('/readyz')) {
        return reply.callNotFound();
      }
      return reply.sendFile('index.html');
    });
  }

  registerEventRoutes(app, ctx);

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapErrorToResponse(error);
    if (mapped.statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
    }
    reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
  });

  app.addHook('onClose', async () => {
    if (watcher) {
      await watcher.close();
    }
  });

  return { app, ctx };
};
