import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildQueryPlan } from '../query/planner';
import { executeQueryPlan } from '../query/executor';
import { loadDatasetForRead, resolveRequestActor, getRequestScopes } from '../service/iam';
import { recordDatasetAccessEvent } from '../db/metadata';
import { randomUUID } from 'node:crypto';

interface QueryRequestRouteParams {
  datasetSlug: string;
}

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.post('/datasets/:datasetSlug/query', async (request, reply) => {
    const { datasetSlug } = request.params as QueryRequestRouteParams;
    const fastifyRequest = request as FastifyRequest;
    const actor = resolveRequestActor(fastifyRequest);
    const scopes = getRequestScopes(fastifyRequest);
    let datasetId: string | null = null;

    const recordFailure = async (stage: string, error: unknown) => {
      await recordDatasetAccessEvent({
        id: `daa-${randomUUID()}`,
        datasetId,
        datasetSlug,
        actorId: actor?.id ?? null,
        actorScopes: scopes,
        action: 'query',
        success: false,
        metadata: {
          stage,
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch((auditError) => {
        (request.log ?? reply.log).error(
          {
            event: 'dataset.query.audit_failed',
            datasetSlug,
            error: auditError instanceof Error ? auditError.message : String(auditError)
          },
          'failed to write dataset access audit log'
        );
      });
    };

    let dataset;
    try {
      dataset = await loadDatasetForRead(fastifyRequest, datasetSlug);
      datasetId = dataset.id;
    } catch (error) {
      await recordFailure('authorize', error);
      throw error;
    }

    try {
      const plan = await buildQueryPlan(datasetSlug, request.body ?? {}, dataset);
      const result = await executeQueryPlan(plan);

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

      await recordDatasetAccessEvent({
        id: `daa-${randomUUID()}`,
        datasetId: dataset.id,
        datasetSlug,
        actorId: actor?.id ?? null,
        actorScopes: scopes,
        action: 'query',
        success: true,
        metadata: {
          mode: result.mode,
          rowCount: result.rows.length,
          rangeStart: plan.rangeStart.toISOString(),
          rangeEnd: plan.rangeEnd.toISOString()
        }
      });

      return reply.status(200).send(result);
    } catch (error) {
      await recordFailure('execute', error);
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
