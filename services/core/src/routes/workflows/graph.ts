import type { FastifyInstance } from 'fastify';
import {
  getWorkflowTopologyGraphCached,
  initializeWorkflowTopologyGraphCache
} from '../../workflows/workflowGraphCache';
import { requireOperatorScopes } from '../shared/operatorAuth';
import { WORKFLOW_READ_SCOPES, WORKFLOW_WRITE_SCOPES } from '../shared/scopes';
import { schemaRef } from '../../openapi/definitions';

function jsonResponse(schemaName: string, description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef(schemaName)
      }
    }
  } as const;
}

const errorResponse = (description: string) => jsonResponse('ErrorResponse', description);

export async function registerWorkflowGraphRoute(app: FastifyInstance): Promise<void> {
  const teardownCacheListeners = initializeWorkflowTopologyGraphCache({ logger: app.log });

  app.addHook('onClose', async () => {
    teardownCacheListeners();
  });

  app.get(
    '/workflows/graph',
    {
      schema: {
        tags: ['Workflows'],
        summary: 'Retrieve workflow topology graph',
        description:
          'Returns the cached workflow topology graph used by the operations console. Requires the workflows:read or workflows:write operator scope.',
        security: [{ OperatorToken: [] }],
        response: {
          200: jsonResponse('WorkflowGraphResponse', 'Current workflow topology graph snapshot.'),
          401: errorResponse('The request lacked an operator token.'),
          403: errorResponse(
            'The supplied operator token did not include the workflows:read or workflows:write scope.'
          ),
          500: errorResponse('The server failed to assemble the workflow topology graph.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'workflows.graph.read',
        resource: 'workflows',
        requiredScopes: [],
        anyOfScopes: [WORKFLOW_READ_SCOPES, WORKFLOW_WRITE_SCOPES]
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
    }
  );
}
