import type { FastifyInstance } from 'fastify';
import {
  getWorkflowTopologyGraphCached,
  initializeWorkflowTopologyGraphCache
} from '../../workflows/workflowGraphCache';
import { requireOperatorScopes } from '../shared/operatorAuth';
import { WORKFLOW_WRITE_SCOPES } from '../shared/scopes';

export async function registerWorkflowGraphRoute(app: FastifyInstance): Promise<void> {
  const teardownCacheListeners = initializeWorkflowTopologyGraphCache({ logger: app.log });

  app.addHook('onClose', async () => {
    teardownCacheListeners();
  });

  app.get('/workflows/graph', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.graph.read',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });

    if (!authResult.ok) {
      return { error: authResult.error };
    }

    try {
      const { graph, meta } = await getWorkflowTopologyGraphCached({ logger: request.log });

      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'workflows.graph.read',
        cacheHit: meta.hit,
        generatedAt: graph.generatedAt
      });

      return {
        data: graph,
        meta: {
          cache: meta
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to load workflow topology graph');
      reply.status(500);
      await authResult.auth.log('failed', {
        action: 'workflows.graph.read',
        reason: 'graph_fetch_failed'
      });
      return { error: 'Failed to load workflow topology graph' };
    }
  });
}
