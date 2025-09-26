import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildQueryPlan } from '../query/planner';
import { executeQueryPlan } from '../query/executor';
import { loadDatasetForRead, resolveRequestActor } from '../service/iam';

interface QueryRequestRouteParams {
  datasetSlug: string;
}

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.post('/datasets/:datasetSlug/query', async (request, reply) => {
    const { datasetSlug } = request.params as QueryRequestRouteParams;
    try {
      const dataset = await loadDatasetForRead(request as FastifyRequest, datasetSlug);
      const plan = await buildQueryPlan(datasetSlug, request.body ?? {}, dataset);
      const result = await executeQueryPlan(plan);

      const actor = resolveRequestActor(request as FastifyRequest);
      (request.log ?? reply.log).info(
        {
          event: 'dataset.query',
          datasetId: dataset.id,
          datasetSlug,
          actorId: actor?.id ?? null,
          scopes: actor?.scopes ?? [],
          mode: result.mode,
          rangeStart: plan.rangeStart.toISOString(),
          rangeEnd: plan.rangeEnd.toISOString()
        },
        'dataset query succeeded'
      );

      return reply.status(200).send(result);
    } catch (error) {
      const actor = resolveRequestActor(request as FastifyRequest);
      (request.log ?? reply.log).error(
        {
          event: 'dataset.query.failed',
          datasetSlug,
          actorId: actor?.id ?? null,
          error: error instanceof Error ? error.message : String(error)
        },
        'dataset query failed'
      );
      throw error;
    }
  });
}
