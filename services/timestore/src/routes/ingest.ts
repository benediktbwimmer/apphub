import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ingestionRequestSchema, ingestionJobPayloadSchema } from '../ingestion/types';
import { enqueueIngestionJob, isInlineQueueMode } from '../queue';
import { StagingQueueFullError } from '../ingestion/stagingManager';
import { loadDatasetForWrite, resolveRequestActor, getRequestScopes } from '../service/iam';
import { recordDatasetAccessEvent } from '../db/metadata';
import { observeIngestion } from '../observability/metrics';
import { endSpan, startSpan } from '../observability/tracing';
import { schemaRef } from '../openapi/definitions';
import { errorResponse, jsonResponse } from '../openapi/utils';

const paramsSchema = z.object({
  datasetSlug: z.string().min(1)
});

const bodySchema = ingestionRequestSchema.omit({ datasetSlug: true });

export async function registerIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/datasets/:datasetSlug/ingest',
    {
      attachValidation: false,
      validatorCompiler: () => () => true,
      schema: {
        tags: ['Ingestion'],
        summary: 'Ingest dataset partition',
        description:
          'Schedules ingestion for a dataset partition. Depending on configuration the job may run inline or be enqueued.',
        params: schemaRef('DatasetSlugParams'),
        body: schemaRef('DatasetIngestionRequest'),
        response: {
          201: jsonResponse('DatasetIngestionInlineResponse', 'Ingestion completed inline.'),
          202: jsonResponse('DatasetIngestionQueuedResponse', 'Ingestion job enqueued for asynchronous processing.'),
          200: jsonResponse('DatasetIngestionQueuedResponse', 'Ingestion job accepted for processing.'),
          400: errorResponse('Invalid ingestion request.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to ingest into this dataset.'),
          404: errorResponse('Dataset not found.'),
          500: errorResponse('Unexpected error while scheduling ingestion.'),
          503: errorResponse('Ingestion staging queue is full. Please retry.')
        }
      }
    },
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const fastifyRequest = request as FastifyRequest;
      const actor = resolveRequestActor(fastifyRequest);
      const scopes = getRequestScopes(fastifyRequest);
      const span = startSpan('timestore.ingest', {
        'timestore.dataset_slug': params.datasetSlug,
        'http.method': request.method,
        'http.route': '/datasets/:datasetSlug/ingest'
      });
      const start = process.hrtime.bigint();
      let mode: 'inline' | 'queued' = 'inline';
      let datasetResult = await loadDatasetForWrite(
        fastifyRequest,
        params.datasetSlug
      ).catch(async (error) => {
        await recordDatasetAccessEvent({
          id: `daa-${randomUUID()}`,
          datasetId: null,
          datasetSlug: params.datasetSlug,
          actorId: actor?.id ?? null,
          actorScopes: scopes,
          action: 'ingest',
          success: false,
          metadata: {
            stage: 'authorize',
            error: error instanceof Error ? error.message : String(error)
          }
        });
        observeIngestion({
          datasetSlug: params.datasetSlug,
          mode,
          result: 'failure',
          durationSeconds: durationSince(start)
        });
        endSpan(span, error);
        throw error;
      });
      let datasetId: string | null = datasetResult?.id ?? null;

      const recordFailure = async (stage: string, error: unknown) => {
        const failureMessage = error instanceof Error ? error.message : String(error);

        await recordDatasetAccessEvent({
          id: `daa-${randomUUID()}`,
          datasetId,
          datasetSlug: params.datasetSlug,
          actorId: actor?.id ?? null,
          actorScopes: scopes,
          action: 'ingest',
          success: false,
          metadata: {
            stage,
            error: failureMessage
          }
        }).catch((auditError) => {
          (request.log ?? reply.log).error(
            {
              event: 'dataset.ingest.audit_failed',
              datasetSlug: params.datasetSlug,
              error: auditError instanceof Error ? auditError.message : String(auditError)
            },
            'failed to write dataset access audit log'
          );
        });
      };

      try {
        const idempotencyHeader = request.headers['idempotency-key'];
        const rawBody =
          typeof request.body === 'object' && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};

        const mergedBody: Record<string, unknown> = { ...rawBody };
        if (typeof idempotencyHeader === 'string' && !mergedBody.idempotencyKey) {
          mergedBody.idempotencyKey = idempotencyHeader;
        }
        if (actor) {
          mergedBody.actor = actor;
        }

        const parsedBody = bodySchema.parse(mergedBody);

        const payload = ingestionJobPayloadSchema.parse({
          ...parsedBody,
          datasetSlug: params.datasetSlug,
          receivedAt: new Date().toISOString()
        });

        const result = await enqueueIngestionJob(payload);

        mode = result.mode;

        if (result.mode === 'inline' && result.result) {
          datasetId = result.result.dataset.id;
          const flushPending = result.result.flushPending ?? false;
          const manifestId = result.result.manifest?.id ?? null;
          (request.log ?? reply.log).info(
            {
              event: flushPending ? 'dataset.ingest.staged' : 'dataset.ingest',
              datasetId: result.result.dataset.id,
              datasetSlug: params.datasetSlug,
              actorId: actor?.id ?? null,
              mode: 'inline',
              flushPending
            },
            flushPending ? 'dataset ingestion staged inline; flush pending' : 'dataset ingestion completed inline'
          );

          await recordDatasetAccessEvent({
            id: `daa-${randomUUID()}`,
            datasetId: result.result.dataset.id,
            datasetSlug: params.datasetSlug,
            actorId: actor?.id ?? null,
            actorScopes: scopes,
            action: 'ingest',
            success: true,
            metadata: {
              mode: 'inline',
              manifestId,
              flushPending
            }
          });

          const durationSeconds = durationSince(start);
          observeIngestion({
            datasetSlug: params.datasetSlug,
            mode,
            result: 'success',
            durationSeconds
          });
          endSpan(span);
          return reply.status(flushPending ? 202 : 201).send({
            mode: 'inline',
            flushPending,
            jobId: flushPending ? `inline:${params.datasetSlug}` : undefined,
            dataset: result.result.dataset,
            storageTarget: result.result.storageTarget,
            manifest: result.result.manifest ?? null
          });
        }

        (request.log ?? reply.log).info(
          {
            event: 'dataset.ingest.enqueued',
            datasetId,
            datasetSlug: params.datasetSlug,
            actorId: actor?.id ?? null,
            mode: 'queued',
            jobId: result.jobId
          },
          'dataset ingestion enqueued'
        );

        await recordDatasetAccessEvent({
          id: `daa-${randomUUID()}`,
          datasetId,
          datasetSlug: params.datasetSlug,
          actorId: actor?.id ?? null,
          actorScopes: scopes,
          action: 'ingest',
          success: true,
          metadata: {
            mode: 'queued',
            jobId: result.jobId
          }
        });

        const durationSeconds = durationSince(start);
        observeIngestion({
          datasetSlug: params.datasetSlug,
          mode,
          result: 'success',
          durationSeconds
        });
        endSpan(span);
        return reply.status(isInlineQueueMode() ? 200 : 202).send({
          mode: result.mode,
          jobId: result.jobId
        });
      } catch (error) {
        await recordFailure('enqueue', error);
        const failureMessage = error instanceof Error ? error.message : String(error);
        observeIngestion({
          datasetSlug: params.datasetSlug,
          mode,
          result: 'failure',
          durationSeconds: durationSince(start)
        });
        endSpan(span, error);
        (request.log ?? reply.log).error(
          {
            event: 'dataset.ingest.failed',
            datasetSlug: params.datasetSlug,
            actorId: actor?.id ?? null,
            error: failureMessage
          },
          'dataset ingestion failed'
        );
        if (error instanceof StagingQueueFullError) {
          return reply.status(503).send({
            error: 'Service Unavailable',
            message: failureMessage
          });
        }
        throw error;
      }
    }
  );
}

function durationSince(start: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - start);
  return elapsed / 1_000_000_000;
}
