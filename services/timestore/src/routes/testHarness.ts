import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorizeAdminAccess } from '../service/iam';
import { getHotBufferTestStore, setHotBufferTestHarness } from '../streaming/hotBuffer';

const paramsSchema = z.object({
  datasetSlug: z.string().min(1)
});

const updateRequestSchema = z
  .object({
    watermark: z.string().min(1).optional(),
    rows: z
      .array(
        z.object({
          timestamp: z.string().min(1),
          payload: z.record(z.unknown())
        })
      )
      .optional(),
    enabled: z.boolean().optional(),
    state: z.enum(['ready', 'unavailable']).optional(),
    clear: z.boolean().optional()
  })
  .strict();

function parseTimestamp(label: string, value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label} timestamp '${value}'`);
  }
  return parsed;
}

export async function registerTestHarnessRoutes(app: FastifyInstance): Promise<void> {
  app.post('/__test__/streaming/hot-buffer/:datasetSlug', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);

    const params = paramsSchema.parse(request.params ?? {});
    const body = updateRequestSchema.parse(request.body ?? {});

    const store = getHotBufferTestStore();
    if (!store) {
      reply.status(503);
      return {
        error: 'Streaming hot buffer test harness is not active'
      };
    }

    if (body.clear) {
      store.clear();
    }

    let rowsAdded = 0;
    if (body.rows) {
      for (const entry of body.rows) {
        const timestampMs = parseTimestamp('row', entry.timestamp);
        store.ingest(params.datasetSlug, entry.payload, timestampMs);
        rowsAdded += 1;
      }
    }

    if (body.watermark) {
      const watermarkMs = parseTimestamp('watermark', body.watermark);
      store.setWatermark(params.datasetSlug, watermarkMs);
    }

    if (body.enabled !== undefined || body.state) {
      setHotBufferTestHarness({
        store,
        enabled: body.enabled ?? true,
        state: body.state ?? 'ready'
      });
    }

    return {
      datasetSlug: params.datasetSlug,
      rowsAdded,
      watermarkApplied: body.watermark ?? null,
      harness: {
        enabled: body.enabled ?? true,
        state: body.state ?? 'ready'
      }
    };
  });
}

