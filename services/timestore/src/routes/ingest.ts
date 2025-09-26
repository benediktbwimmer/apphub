import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ingestionRequestSchema, ingestionJobPayloadSchema } from '../ingestion/types';
import { enqueueIngestionJob, isInlineQueueMode } from '../queue';
import { loadDatasetForWrite, resolveRequestActor } from '../service/iam';

const paramsSchema = z.object({
  datasetSlug: z.string().min(1)
});

const bodySchema = ingestionRequestSchema.omit({ datasetSlug: true });

export async function registerIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/datasets/:datasetSlug/ingest', async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const actor = resolveRequestActor(request as FastifyRequest);

    try {
      const dataset = await loadDatasetForWrite(request as FastifyRequest, params.datasetSlug);

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

      if (result.mode === 'inline' && result.result) {
        (request.log ?? reply.log).info(
          {
            event: 'dataset.ingest',
            datasetId: result.result.dataset.id,
            datasetSlug: params.datasetSlug,
            actorId: actor?.id ?? null,
            mode: 'inline'
          },
          'dataset ingestion completed inline'
        );
        return reply.status(201).send({
          mode: 'inline',
          manifest: result.result.manifest,
          dataset: result.result.dataset,
          storageTarget: result.result.storageTarget
        });
      }

      (request.log ?? reply.log).info(
        {
          event: 'dataset.ingest.enqueued',
          datasetId: dataset?.id ?? null,
          datasetSlug: params.datasetSlug,
          actorId: actor?.id ?? null,
          mode: 'queued',
          jobId: result.jobId
        },
        'dataset ingestion enqueued'
      );

      return reply.status(isInlineQueueMode() ? 200 : 202).send({
        mode: result.mode,
        jobId: result.jobId
      });
    } catch (error) {
      (request.log ?? reply.log).error(
        {
          event: 'dataset.ingest.failed',
          datasetSlug: params.datasetSlug,
          actorId: actor?.id ?? null,
          error: error instanceof Error ? error.message : String(error)
        },
        'dataset ingestion failed'
      );
      throw error;
    }
  });
}
