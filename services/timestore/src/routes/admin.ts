import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadServiceConfig } from '../config/serviceConfig';
import { getLifecycleJobRun, listRecentLifecycleJobRuns } from '../db/metadata';
import { runLifecycleJob, getMaintenanceMetrics } from '../lifecycle/maintenance';
import { enqueueLifecycleJob, isLifecycleInlineMode } from '../lifecycle/queue';
import type { LifecycleJobPayload, LifecycleOperation } from '../lifecycle/types';

const runRequestSchema = z.object({
  datasetId: z.string().optional(),
  datasetSlug: z.string().optional(),
  operations: z.array(z.enum(['compaction', 'retention', 'parquetExport'])).optional(),
  mode: z.enum(['inline', 'queue']).optional()
});

const statusQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  datasetId: z.string().optional()
});

const rescheduleSchema = z.object({
  jobId: z.string()
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const config = loadServiceConfig();

  app.post('/admin/lifecycle/run', async (request, reply) => {
    const body = runRequestSchema.parse(request.body ?? {});
    if (!body.datasetId && !body.datasetSlug) {
      reply.status(400);
      return {
        error: 'datasetId or datasetSlug is required'
      };
    }

    const payload: LifecycleJobPayload = {
      datasetId: body.datasetId ?? '',
      datasetSlug: body.datasetSlug ?? '',
      operations: body.operations ?? [],
      trigger: 'api',
      requestId: randomUUID(),
      requestedAt: new Date().toISOString(),
      scheduledFor: null
    };

    if ((body.mode ?? 'inline') === 'queue') {
      if (isLifecycleInlineMode()) {
        reply.status(400);
        return {
          error: 'queue mode unavailable when REDIS_URL=inline'
        };
      }
      await enqueueLifecycleJob(config, payload, {
        jobId: payload.requestId,
        removeOnComplete: false,
        removeOnFail: false
      });
      reply.status(202);
      return {
        jobId: payload.requestId,
        status: 'queued'
      };
    }

    const report = await runLifecycleJob(config, payload);
    return {
      status: 'completed',
      report
    };
  });

  app.get('/admin/lifecycle/status', async (request) => {
    const query = statusQuerySchema.parse(request.query ?? {});
    const jobs = await listRecentLifecycleJobRuns(query.limit ?? 20);
    const metrics = getMaintenanceMetrics();
    const datasetFiltered = query.datasetId
      ? jobs.filter((job) => job.datasetId === query.datasetId)
      : jobs;
    return {
      jobs: datasetFiltered,
      metrics
    };
  });

  app.post('/admin/lifecycle/reschedule', async (request, reply) => {
    if (isLifecycleInlineMode()) {
      reply.status(400);
      return {
        error: 'reschedule unavailable when REDIS_URL=inline'
      };
    }

    const body = rescheduleSchema.parse(request.body ?? {});
    const existing = await getLifecycleJobRun(body.jobId);
    if (!existing) {
      reply.status(404);
      return {
        error: `job ${body.jobId} not found`
      };
    }

    if (!existing.datasetId) {
      reply.status(400);
      return {
        error: 'job is not associated with a dataset'
      };
    }

    const payload: LifecycleJobPayload = {
      datasetId: existing.datasetId,
      datasetSlug: '',
      operations: existing.operations.filter(isLifecycleOperation),
      trigger: 'api',
      requestId: randomUUID(),
      requestedAt: new Date().toISOString(),
      scheduledFor: null
    };

    await enqueueLifecycleJob(config, payload, {
      jobId: payload.requestId,
      removeOnComplete: false,
      removeOnFail: false
    });

    return {
      status: 'queued',
      jobId: payload.requestId
    };
  });
}

function isLifecycleOperation(value: string): value is LifecycleOperation {
  return value === 'compaction' || value === 'retention' || value === 'parquetExport';
}
