import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildQueryPlan } from '../query/planner';
import { executeQueryPlan } from '../query/executor';
import { queryRequestSchema } from '../query/types';
import { authorizeDatasetAccess } from '../service/iam';

interface QueryRequestRouteParams {
  datasetSlug: string;
}

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.post('/datasets/:datasetSlug/query', async (request, reply) => {
    const { datasetSlug } = request.params as QueryRequestRouteParams;
    await authorizeDatasetAccess(request as FastifyRequest, datasetSlug);

    const plan = await buildQueryPlan(datasetSlug, request.body ?? {});
    const result = await executeQueryPlan(plan);

    return reply.status(200).send(result);
  });
}
