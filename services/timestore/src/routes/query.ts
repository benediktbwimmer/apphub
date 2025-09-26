import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildQueryPlan } from '../query/planner';
import { executeQueryPlan } from '../query/executor';
import { loadDatasetForRead, resolveRequestActor, getRequestScopes } from '../service/iam';
import { recordDatasetAccessEvent } from '../db/metadata';
import { randomUUID } from 'node:crypto';
import { observeQuery } from '../observability/metrics';
import { endSpan, startSpan } from '../observability/tracing';
import { loadServiceConfig } from '../config/serviceConfig';

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
    const span = startSpan('timestore.query', {
      'timestore.dataset_slug': datasetSlug,
      'http.method': request.method,
      'http.route': '/datasets/:datasetSlug/query'
    });
    const start = process.hrtime.bigint();
    const config = loadServiceConfig();
    let mode: 'raw' | 'downsampled' = 'raw';
    let remotePartitions = 0;

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
      observeQuery({
        datasetSlug,
        mode,
        result: 'failure',
        durationSeconds: durationSince(start),
        remotePartitions,
        cacheEnabled: config.query.cache.enabled
      });
      endSpan(span, error);
      throw error;
    }

    try {
      const plan = await buildQueryPlan(datasetSlug, request.body ?? {}, dataset);
      mode = plan.mode;
      remotePartitions = countRemotePartitions(plan);
      const result = await executeQueryPlan(plan);
      const durationSeconds = durationSince(start);

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

      observeQuery({
        datasetSlug,
        mode: result.mode,
        result: 'success',
        durationSeconds,
        rowCount: result.rows.length,
        remotePartitions,
        cacheEnabled: config.query.cache.enabled
      });
      if (span) {
        span.setAttribute('timestore.query.mode', result.mode);
        span.setAttribute('timestore.query.rows', result.rows.length);
        span.setAttribute('timestore.query.remote_partitions', remotePartitions);
      }
      endSpan(span);

      return reply.status(200).send(result);
    } catch (error) {
      await recordFailure('execute', error);
      observeQuery({
        datasetSlug,
        mode,
        result: 'failure',
        durationSeconds: durationSince(start),
        remotePartitions,
        cacheEnabled: config.query.cache.enabled
      });
      endSpan(span, error);
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

function durationSince(start: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - start);
  return elapsed / 1_000_000_000;
}

function countRemotePartitions(plan: Awaited<ReturnType<typeof buildQueryPlan>>): number {
  return plan.partitions.filter((partition) =>
    partition.location.startsWith('s3://') ||
    partition.location.startsWith('http://') ||
    partition.location.startsWith('https://')
  ).length;
}
