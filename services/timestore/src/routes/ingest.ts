import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ingestionRequestSchema, ingestionJobPayloadSchema } from '../ingestion/types';
import { enqueueIngestionJob, isInlineQueueMode } from '../queue';

const paramsSchema = z.object({
  datasetSlug: z.string().min(1)
});

const bodySchema = ingestionRequestSchema.omit({ datasetSlug: true });

export async function registerIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/datasets/:datasetSlug/ingest', async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const idempotencyHeader = request.headers['idempotency-key'];
    const rawBody =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const mergedBody: Record<string, unknown> = { ...rawBody };
    if (typeof idempotencyHeader === 'string' && !mergedBody.idempotencyKey) {
      mergedBody.idempotencyKey = idempotencyHeader;
    }

    const parsedBody = bodySchema.parse(mergedBody);

    const payload = ingestionJobPayloadSchema.parse({
      ...parsedBody,
      datasetSlug: params.datasetSlug,
      receivedAt: new Date().toISOString()
    });

    const result = await enqueueIngestionJob(payload);

    if (result.mode === 'inline' && result.result) {
      return reply.status(201).send({
        mode: 'inline',
        manifest: result.result.manifest,
        dataset: result.result.dataset,
        storageTarget: result.result.storageTarget
      });
    }

    return reply.status(isInlineQueueMode() ? 200 : 202).send({
      mode: result.mode,
      jobId: result.jobId
    });
  });
}
