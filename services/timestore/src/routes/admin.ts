import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadServiceConfig } from '../config/serviceConfig';
import {
  getLifecycleJobRun,
  listRecentLifecycleJobRuns,
  listDatasets,
  listStorageTargets,
  getDatasetById,
  getDatasetBySlug,
  getLatestPublishedManifest,
  getRetentionPolicy,
  upsertRetentionPolicy,
  updateDatasetDefaultStorageTarget,
  getStorageTargetById,
  recordLifecycleAuditEvent
} from '../db/metadata';
import type { DatasetRecord } from '../db/metadata';
import { runLifecycleJob, getMaintenanceMetrics } from '../lifecycle/maintenance';
import { enqueueLifecycleJob, isLifecycleInlineMode } from '../lifecycle/queue';
import {
  createDefaultRetentionPolicy,
  parseRetentionPolicy,
  retentionPolicySchema,
  type LifecycleJobPayload,
  type LifecycleOperation
} from '../lifecycle/types';
import { authorizeAdminAccess } from '../service/iam';

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

const datasetListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
  search: z.string().min(1).optional()
});

const datasetParamsSchema = z.object({
  datasetId: z.string().min(1)
});

const retentionUpdateSchema = retentionPolicySchema;

const storageTargetQuerySchema = z.object({
  kind: z.enum(['local', 's3', 'gcs', 'azure_blob']).optional()
});

const storageTargetUpdateSchema = z.object({
  storageTargetId: z.string().min(1)
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const config = loadServiceConfig();

  app.post('/admin/lifecycle/run', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
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
    await authorizeAdminAccess(request as FastifyRequest);
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
    await authorizeAdminAccess(request as FastifyRequest);
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

  app.get('/admin/datasets', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const query = datasetListQuerySchema.parse(request.query ?? {});
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      reply.status(400);
      return {
        error: 'invalid cursor'
      };
    }

    const { datasets, nextCursor } = await listDatasets({
      limit: query.limit ?? 20,
      cursor,
      status: query.status ?? 'active',
      search: query.search
    });

    return {
      datasets,
      nextCursor: nextCursor ? encodeCursor(nextCursor) : null
    };
  });

  app.get('/admin/datasets/:datasetId', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    return {
      dataset
    };
  });

  app.get('/admin/datasets/:datasetId/manifest', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const manifest = await getLatestPublishedManifest(dataset.id);
    if (!manifest) {
      reply.status(404);
      return {
        error: 'no published manifest'
      };
    }

    return {
      datasetId: dataset.id,
      manifest
    };
  });

  app.get('/admin/datasets/:datasetId/retention', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const record = await getRetentionPolicy(dataset.id);
    const defaultPolicy = createDefaultRetentionPolicy(config);
    const effectivePolicy = parseRetentionPolicy(record, defaultPolicy);

    return {
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      policy: record?.policy ?? null,
      updatedAt: record?.updatedAt ?? null,
      effectivePolicy,
      defaultPolicy
    };
  });

  app.put('/admin/datasets/:datasetId/retention', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const body = retentionUpdateSchema.parse(request.body ?? {});
    const record = await upsertRetentionPolicy(dataset.id, body);

    await recordLifecycleAuditEvent({
      id: `la-${randomUUID()}`,
      datasetId: dataset.id,
      manifestId: null,
      eventType: 'admin.retention.updated',
      payload: {
        datasetId: dataset.id,
        datasetSlug: dataset.slug,
        policy: record.policy,
        actor: resolveActor(request)
      }
    });

    const defaultPolicy = createDefaultRetentionPolicy(config);
    const effectivePolicy = parseRetentionPolicy(record, defaultPolicy);

    return {
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      policy: record.policy,
      updatedAt: record.updatedAt,
      effectivePolicy
    };
  });

  app.get('/admin/storage-targets', async (request) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const query = storageTargetQuerySchema.parse(request.query ?? {});
    const targets = await listStorageTargets(query.kind);
    return {
      storageTargets: targets
    };
  });

  app.put('/admin/datasets/:datasetId/storage-target', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const body = storageTargetUpdateSchema.parse(request.body ?? {});
    const storageTarget = await getStorageTargetById(body.storageTargetId);
    if (!storageTarget) {
      reply.status(404);
      return {
        error: `storage target ${body.storageTargetId} not found`
      };
    }

    await updateDatasetDefaultStorageTarget(dataset.id, storageTarget.id);

    await recordLifecycleAuditEvent({
      id: `la-${randomUUID()}`,
      datasetId: dataset.id,
      manifestId: null,
      eventType: 'admin.storage-target.updated',
      payload: {
        datasetId: dataset.id,
        datasetSlug: dataset.slug,
        storageTargetId: storageTarget.id,
        actor: resolveActor(request)
      }
    });

    const updatedDataset = await getDatasetById(dataset.id);

    return {
      dataset: updatedDataset ?? dataset,
      storageTarget
    };
  });
}

function isLifecycleOperation(value: string): value is LifecycleOperation {
  return value === 'compaction' || value === 'retention' || value === 'parquetExport';
}

async function resolveDataset(identifier: string): Promise<DatasetRecord | null> {
  const byId = await getDatasetById(identifier);
  if (byId) {
    return byId;
  }
  return getDatasetBySlug(identifier);
}

function resolveActor(request: FastifyRequest): string | null {
  const actorHeader = request.headers['x-iam-user'] ?? request.headers['x-user-id'];
  if (typeof actorHeader === 'string' && actorHeader.trim().length > 0) {
    return actorHeader.trim();
  }
  return null;
}

function encodeCursor(cursor: { updatedAt: string; id: string }): string {
  const payload = JSON.stringify(cursor);
  return Buffer.from(payload, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string): { updatedAt: string; id: string } | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt === 'string' && typeof parsed.id === 'string') {
      return {
        updatedAt: parsed.updatedAt,
        id: parsed.id
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}
