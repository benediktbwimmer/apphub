import type { FastifyInstance } from 'fastify';

import type { AppContext } from '../types';

export const registerHealthRoutes = (app: FastifyInstance, ctx: AppContext) => {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (request, reply) => {
    const { readiness } = ctx;
    const components: Record<string, boolean> = {
      store: readiness.store,
      watcher: readiness.watcher
    };

    const allReady = Object.values(components).every(Boolean);

    if (!allReady) {
      ctx.metrics.readinessGauge.set({ component: 'store' }, readiness.store ? 1 : 0);
      ctx.metrics.readinessGauge.set({ component: 'watcher' }, readiness.watcher ? 1 : 0);
      return reply.status(503).send({ status: 'not_ready', components });
    }

    ctx.metrics.readinessGauge.set({ component: 'store' }, 1);
    ctx.metrics.readinessGauge.set({ component: 'watcher' }, 1);
    return { status: 'ready', components };
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', ctx.metrics.register.contentType);
    return ctx.metrics.register.metrics();
  });
};
