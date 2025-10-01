import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createDatasetRequestSchema,
  patchDatasetRequestSchema,
  archiveDatasetRequestSchema,
  type CreateDatasetRequest,
  type PatchDatasetRequest,
  type ArchiveDatasetRequest,
  type DatasetMetadata,
  type DatasetAccessAuditListResponse
} from '@apphub/shared/timestoreAdmin';
import { loadServiceConfig } from '../config/serviceConfig';
import {
  getLifecycleJobRun,
  listRecentLifecycleJobRuns,
  listDatasets,
  listDatasetAccessEvents,
  listStorageTargets,
  getDatasetById,
  getDatasetBySlug,
  getLatestPublishedManifest,
  getSchemaVersionById,
  getRetentionPolicy,
  listPublishedManifestsWithPartitions,
  upsertRetentionPolicy,
  updateDatasetDefaultStorageTarget,
  getStorageTargetById,
  recordLifecycleAuditEvent,
  recordDatasetAccessEvent,
  createDataset,
  updateDataset,
  DatasetConcurrentUpdateError,
  type DatasetAccessAuditCursor
} from '../db/metadata';
import {
  getManifestCacheSummary,
  invalidateManifestCache,
  invalidateManifestShard
} from '../cache/manifestCache';
import type { DatasetRecord, JsonObject } from '../db/metadata';
import { runLifecycleJob, getMaintenanceMetrics } from '../lifecycle/maintenance';
import { enqueueLifecycleJob, getLifecycleQueueHealth } from '../lifecycle/queue';
import {
  createDefaultRetentionPolicy,
  parseRetentionPolicy,
  retentionPolicySchema,
  type LifecycleJobPayload,
  type LifecycleOperation
} from '../lifecycle/types';
import { authorizeAdminAccess, resolveRequestActor, getRequestScopes } from '../service/iam';
import { invalidateSqlRuntimeCache, getSqlRuntimeCacheSnapshot } from '../sql/runtime';

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

const manifestQuerySchema = z.object({
  shard: z.string().min(1).optional()
});

const manifestCacheInvalidateSchema = z.object({
  shards: z.array(z.string().min(1)).max(100).optional()
});

const datasetAuditQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  action: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  actions: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  success: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional()
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

    const lifecycleHealth = getLifecycleQueueHealth();

    if ((body.mode ?? 'inline') === 'queue') {
      if (lifecycleHealth.inline) {
        reply.status(400);
        return {
          error: 'queue mode unavailable when REDIS_URL=inline',
          lifecycle: lifecycleHealth
        };
      }
      if (!lifecycleHealth.ready) {
        reply.status(503);
        return {
          error: lifecycleHealth.lastError ?? 'lifecycle queue not ready',
          lifecycle: lifecycleHealth
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

  app.get('/admin/sql/runtime-cache', async (request) => {
    await authorizeAdminAccess(request as FastifyRequest);
    return {
      snapshot: getSqlRuntimeCacheSnapshot()
    };
  });

  app.post('/admin/lifecycle/reschedule', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const lifecycleHealth = getLifecycleQueueHealth();
    if (lifecycleHealth.inline) {
      reply.status(400);
      return {
        error: 'reschedule unavailable when REDIS_URL=inline',
        lifecycle: lifecycleHealth
      };
    }
    if (!lifecycleHealth.ready) {
      reply.status(503);
      return {
        error: lifecycleHealth.lastError ?? 'lifecycle queue not ready',
        lifecycle: lifecycleHealth
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

  app.post('/admin/datasets', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const body = createDatasetRequestSchema.parse(request.body ?? {});

    if (body.defaultStorageTargetId) {
      const target = await getStorageTargetById(body.defaultStorageTargetId);
      if (!target) {
        await recordDatasetAccessEvent({
          id: `da-${randomUUID()}`,
          datasetId: null,
          datasetSlug: body.slug,
          actorId: resolveAuditActor(request)?.id ?? null,
          actorScopes: getRequestScopes(request),
          action: 'admin.dataset.created',
          success: false,
          metadata: {
            reason: 'storage_target_not_found',
            storageTargetId: body.defaultStorageTargetId
          }
        });
        reply.status(404);
        return {
          error: `storage target ${body.defaultStorageTargetId} not found`
        };
      }
    }

    const metadata = normalizeDatasetMetadata(body.metadata);
    const datasetId = `ds-${randomUUID()}`;
    let dataset: DatasetRecord | null = null;
    let created = false;

    try {
      dataset = await createDataset({
        id: datasetId,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        status: body.status,
        writeFormat: body.writeFormat,
        defaultStorageTargetId: body.defaultStorageTargetId ?? null,
        metadata
      });
      created = true;
    } catch (error) {
      if (isUniqueViolation(error, 'datasets_slug_key')) {
        dataset = await getDatasetBySlug(body.slug);
        if (!dataset || !datasetMatchesCreateRequest(dataset, body, metadata)) {
          await recordDatasetAccessEvent({
            id: `da-${randomUUID()}`,
            datasetId: dataset?.id ?? null,
            datasetSlug: body.slug,
            actorId: resolveAuditActor(request)?.id ?? null,
            actorScopes: getRequestScopes(request),
            action: 'admin.dataset.created',
            success: false,
            metadata: {
              reason: 'slug_conflict',
              request: createAuditRequestSnapshot(body, metadata),
              existing: dataset ? serializeDatasetForAudit(dataset) : null
            }
          });
          reply.status(409);
          return {
            error: `dataset ${body.slug} already exists`
          };
        }
      } else {
        throw error;
      }
    }

    if (!dataset) {
      throw new Error('Dataset creation failed to return a record');
    }

    const actor = resolveAuditActor(request);
    await recordDatasetAccessEvent({
      id: `da-${randomUUID()}`,
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      actorId: actor?.id ?? null,
      actorScopes: actor?.scopes ?? getRequestScopes(request),
      action: created ? 'admin.dataset.created' : 'admin.dataset.created.idempotent',
      success: true,
      metadata: {
        request: createAuditRequestSnapshot(body, metadata),
        dataset: serializeDatasetForAudit(dataset),
        idempotencyKey: body.idempotencyKey ?? null,
        created
      }
    });

    invalidateSqlRuntimeCache({
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      reason: 'admin-create'
    });

    reply.header('etag', dataset.updatedAt);
    if (created) {
      reply.status(201);
    }
    return {
      dataset,
      etag: dataset.updatedAt
    };
  });

  app.patch('/admin/datasets/:datasetId', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const body = patchDatasetRequestSchema.parse(request.body ?? {});
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    if (body.defaultStorageTargetId !== undefined && body.defaultStorageTargetId !== null) {
      const target = await getStorageTargetById(body.defaultStorageTargetId);
      if (!target) {
        await recordDatasetAccessEvent({
          id: `da-${randomUUID()}`,
          datasetId: dataset.id,
          datasetSlug: dataset.slug,
          actorId: resolveAuditActor(request)?.id ?? null,
          actorScopes: getRequestScopes(request),
          action: 'admin.dataset.updated',
          success: false,
          metadata: {
            reason: 'storage_target_not_found',
            storageTargetId: body.defaultStorageTargetId
          }
        });
        reply.status(404);
        return {
          error: `storage target ${body.defaultStorageTargetId} not found`
        };
      }
    }

    const ifMatchResolution = resolveIfMatch(request, body.ifMatch ?? null);
    if (!ifMatchResolution.valid) {
      reply.status(400);
      return {
        error: 'ifMatch must be an RFC 3339 timestamp'
      };
    }
    const ifMatch = ifMatchResolution.value;
    const metadataUpdate = body.metadata !== undefined ? mergeDatasetMetadata(dataset.metadata, body.metadata) : undefined;

    try {
      const updated = await updateDataset({
        id: dataset.id,
        name: body.name,
        description: body.description,
        status: body.status,
        defaultStorageTargetId: body.defaultStorageTargetId,
        metadata: metadataUpdate,
        ifMatch
      });

      const actor = resolveAuditActor(request);
      const diff = diffDatasets(dataset, updated);

      await recordDatasetAccessEvent({
        id: `da-${randomUUID()}`,
        datasetId: updated.id,
        datasetSlug: updated.slug,
        actorId: actor?.id ?? null,
        actorScopes: actor?.scopes ?? getRequestScopes(request),
        action: 'admin.dataset.updated',
        success: true,
        metadata: {
          before: serializeDatasetForAudit(dataset),
          after: serializeDatasetForAudit(updated),
          fieldsChanged: diff
        }
      });

      invalidateSqlRuntimeCache({
        datasetId: updated.id,
        datasetSlug: updated.slug,
        reason: 'admin-update'
      });

      reply.header('etag', updated.updatedAt);
      return {
        dataset: updated,
        etag: updated.updatedAt
      };
    } catch (error) {
      if (error instanceof DatasetConcurrentUpdateError) {
        await recordDatasetAccessEvent({
          id: `da-${randomUUID()}`,
          datasetId: dataset.id,
          datasetSlug: dataset.slug,
          actorId: resolveAuditActor(request)?.id ?? null,
          actorScopes: getRequestScopes(request),
          action: 'admin.dataset.updated',
          success: false,
          metadata: {
            reason: 'concurrency_conflict',
            ifMatch
          }
        });
        reply.status(412);
        return {
          error: 'dataset was modified since last read'
        };
      }
      throw error;
    }
  });

  app.post('/admin/datasets/:datasetId/archive', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const body = archiveDatasetRequestSchema.parse(request.body ?? {});
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const ifMatchResolution = resolveIfMatch(request, body.ifMatch ?? null);
    if (!ifMatchResolution.valid) {
      reply.status(400);
      return {
        error: 'ifMatch must be an RFC 3339 timestamp'
      };
    }
    const ifMatch = ifMatchResolution.value;
    const actor = resolveAuditActor(request);

    try {
      const beforeSnapshot = serializeDatasetForAudit(dataset);
      const updated =
        dataset.status === 'inactive'
          ? await updateDataset({ id: dataset.id, ifMatch })
          : await updateDataset({ id: dataset.id, status: 'inactive', ifMatch });

      await recordDatasetAccessEvent({
        id: `da-${randomUUID()}`,
        datasetId: updated.id,
        datasetSlug: updated.slug,
        actorId: actor?.id ?? null,
        actorScopes: actor?.scopes ?? getRequestScopes(request),
        action: 'admin.dataset.archived',
        success: true,
        metadata: {
          before: beforeSnapshot,
          after: serializeDatasetForAudit(updated),
          reason: body.reason ?? null,
          idempotent: dataset.status === 'inactive'
        }
      });

      invalidateSqlRuntimeCache({
        datasetId: updated.id,
        datasetSlug: updated.slug,
        reason: 'admin-archive'
      });

      reply.header('etag', updated.updatedAt);
      return {
        dataset: updated,
        etag: updated.updatedAt
      };
    } catch (error) {
      if (error instanceof DatasetConcurrentUpdateError) {
        await recordDatasetAccessEvent({
          id: `da-${randomUUID()}`,
          datasetId: dataset.id,
          datasetSlug: dataset.slug,
          actorId: actor?.id ?? null,
          actorScopes: actor?.scopes ?? getRequestScopes(request),
          action: 'admin.dataset.archived',
          success: false,
          metadata: {
            reason: 'concurrency_conflict',
            ifMatch
          }
        });
        reply.status(412);
        return {
          error: 'dataset was modified since last read'
        };
      }
      throw error;
    }
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

  app.get('/admin/datasets/:datasetId/audit', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const rawQuery = datasetAuditQuerySchema.parse(request.query ?? {});
    const cursor = rawQuery.cursor ? decodeAuditCursor(rawQuery.cursor) : null;
    if (rawQuery.cursor && !cursor) {
      reply.status(400);
      return {
        error: 'invalid cursor'
      };
    }

    const actions = Array.from(
      new Set([
        ...normalizeQueryValues(rawQuery.action),
        ...normalizeQueryValues(rawQuery.actions)
      ])
    );
    const successRaw = normalizeQuerySingle(rawQuery.success);
    let successFilter: boolean | null = null;
    if (successRaw !== null) {
      const parsed = parseBooleanFlag(successRaw);
      if (parsed === null) {
        reply.status(400);
        return {
          error: 'success must be true or false'
        };
      }
      successFilter = parsed;
    }

    const startTimeIso = normalizeIsoTimestamp(rawQuery.startTime);
    if (rawQuery.startTime && !startTimeIso) {
      reply.status(400);
      return {
        error: 'startTime must be an ISO-8601 timestamp'
      };
    }

    const endTimeIso = normalizeIsoTimestamp(rawQuery.endTime);
    if (rawQuery.endTime && !endTimeIso) {
      reply.status(400);
      return {
        error: 'endTime must be an ISO-8601 timestamp'
      };
    }

    if (startTimeIso && endTimeIso && startTimeIso > endTimeIso) {
      reply.status(400);
      return {
        error: 'startTime must be before or equal to endTime'
      };
    }

    const auditResult = await listDatasetAccessEvents(dataset.id, {
      limit: rawQuery.limit,
      cursor,
      actions,
      success: successFilter,
      startTime: startTimeIso,
      endTime: endTimeIso
    });

    const responseBody: DatasetAccessAuditListResponse = {
      events: auditResult.events,
      nextCursor: auditResult.nextCursor ? encodeAuditCursor(auditResult.nextCursor) : null
    };

    return responseBody;
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

    const { shard } = manifestQuerySchema.parse(request.query);

    if (shard) {
      const manifest = await getLatestPublishedManifest(dataset.id, { shard });
      if (!manifest) {
        reply.status(404);
        return {
          error: `no published manifest for shard ${shard}`
        };
      }

      const schemaVersion = manifest.schemaVersionId
        ? await getSchemaVersionById(manifest.schemaVersionId)
        : null;

      const manifestWithSchema = {
        ...manifest,
        schemaVersion: schemaVersion
          ? {
              id: schemaVersion.id,
              version: schemaVersion.version,
              fields: extractSchemaFields(schemaVersion.schema)
            }
          : null
      } as const;

      return {
        datasetId: dataset.id,
        manifest: manifestWithSchema
      };
    }

    const manifests = await listPublishedManifestsWithPartitions(dataset.id);
    if (manifests.length === 0) {
      reply.status(404);
      return {
        error: 'no published manifests'
      };
    }

    const manifestsWithSchema = await Promise.all(
      manifests.map(async (entry) => {
        const schemaVersion = entry.schemaVersionId
          ? await getSchemaVersionById(entry.schemaVersionId)
          : null;
        return {
          ...entry,
          schemaVersion: schemaVersion
            ? {
                id: schemaVersion.id,
                version: schemaVersion.version,
                fields: extractSchemaFields(schemaVersion.schema)
              }
            : null
        } as const;
      })
    );

    return {
      datasetId: dataset.id,
      manifests: manifestsWithSchema
    };
  });

  app.get('/admin/datasets/:datasetId/manifest-cache', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const summary = await getManifestCacheSummary(dataset.slug);
    return {
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      enabled: summary.enabled,
      indexCachedAt: summary.indexCachedAt,
      shardCount: summary.shardCount,
      shards: summary.shards
    };
  });

  app.post('/admin/datasets/:datasetId/manifest-cache/invalidate', async (request, reply) => {
    await authorizeAdminAccess(request as FastifyRequest);
    const { datasetId } = datasetParamsSchema.parse(request.params);
    const dataset = await resolveDataset(datasetId);
    if (!dataset) {
      reply.status(404);
      return {
        error: `dataset ${datasetId} not found`
      };
    }

    const manifestCacheEnabled = config.query.manifestCache.enabled;
    if (!manifestCacheEnabled) {
      await recordDatasetAccessEvent({
        id: `da-${randomUUID()}`,
        datasetId: dataset.id,
        datasetSlug: dataset.slug,
        actorId: resolveAuditActor(request)?.id ?? null,
        actorScopes: getRequestScopes(request),
        action: 'admin.manifest_cache.invalidate',
        success: false,
        metadata: {
          mode: 'none',
          reason: 'manifest_cache_disabled'
        }
      });

      return {
        datasetId: dataset.id,
        datasetSlug: dataset.slug,
        enabled: false,
        mode: 'none',
        invalidatedShards: []
      } as const;
    }

    const payload = manifestCacheInvalidateSchema.parse(request.body ?? {});
    const actor = resolveAuditActor(request);

    const datasetRef = { id: dataset.id, slug: dataset.slug } as const;
    let invalidatedShards: string[] | null = null;
    let mode: 'all' | 'partial' = 'all';

    if (payload.shards && payload.shards.length > 0) {
      const uniqueShards = Array.from(
        new Set(
          payload.shards
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        )
      );
      mode = 'partial';
      invalidatedShards = [];
      for (const shard of uniqueShards) {
        await invalidateManifestShard(datasetRef, shard);
        invalidatedShards.push(shard);
      }
    } else {
      await invalidateManifestCache(dataset.slug);
    }

    await recordDatasetAccessEvent({
      id: `da-${randomUUID()}`,
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      actorId: actor?.id ?? null,
      actorScopes: actor?.scopes ?? getRequestScopes(request),
      action: 'admin.manifest_cache.invalidate',
      success: true,
      metadata: {
        mode,
        shards: invalidatedShards
      }
    });

    return {
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      enabled: true,
      mode,
      invalidatedShards
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

    invalidateSqlRuntimeCache({
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      reason: 'admin-storage-target'
    });

    const updatedDataset = await getDatasetById(dataset.id);

    return {
      dataset: updatedDataset ?? dataset,
      storageTarget
    };
  });
}

interface AuditActor {
  id: string | null;
  scopes: string[];
}

interface IfMatchResolution {
  value: string | null;
  valid: boolean;
}

interface SchemaField {
  name: string;
  type: string;
}

function extractSchemaFields(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const fieldsValue = (schema as { fields?: unknown }).fields;
  if (!Array.isArray(fieldsValue)) {
    return [];
  }
  const fields: SchemaField[] = [];
  for (const entry of fieldsValue) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const { name, type } = entry as { name?: unknown; type?: unknown };
    if (typeof name !== 'string' || name.trim().length === 0) {
      continue;
    }
    if (typeof type !== 'string' || type.trim().length === 0) {
      continue;
    }
    fields.push({ name: name.trim(), type: type.trim() });
  }
  return fields;
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

function resolveAuditActor(request: FastifyRequest): AuditActor | null {
  const actor = resolveRequestActor(request);
  if (actor) {
    return actor;
  }
  const scopes = getRequestScopes(request);
  if (scopes.length > 0) {
    return {
      id: null,
      scopes
    };
  }
  return null;
}

function resolveActor(request: FastifyRequest): string | null {
  const actorHeader = request.headers['x-iam-user'] ?? request.headers['x-user-id'];
  if (typeof actorHeader === 'string' && actorHeader.trim().length > 0) {
    return actorHeader.trim();
  }
  return null;
}

function resolveIfMatch(request: FastifyRequest, value: string | null): IfMatchResolution {
  const candidate = (() => {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
    const header = request.headers['if-match'];
    if (typeof header === 'string' && header.trim().length > 0) {
      return header.trim();
    }
    return null;
  })();

  if (!candidate) {
    return {
      value: null,
      valid: true
    };
  }

  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) {
    return {
      value: candidate,
      valid: false
    };
  }

  return {
    value: new Date(parsed).toISOString(),
    valid: true
  };
}

function normalizeQueryValues(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

function normalizeQuerySingle(value: string | string[] | undefined): string | null {
  const entries = normalizeQueryValues(value);
  if (entries.length === 0) {
    return null;
  }
  return entries[entries.length - 1];
}

function parseBooleanFlag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return null;
}

function normalizeIsoTimestamp(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: string; constraint?: string };
  if (candidate.code !== '23505') {
    return false;
  }
  if (constraint && candidate.constraint !== constraint) {
    return false;
  }
  return true;
}

function normalizeDatasetMetadata(metadata?: DatasetMetadata | null): JsonObject {
  if (!metadata) {
    return {};
  }
  return mergeDatasetMetadata({}, metadata);
}

function mergeDatasetMetadata(base: JsonObject, patch: DatasetMetadata | undefined): JsonObject {
  const result = cloneJsonObject(base);
  if (!patch || typeof patch !== 'object') {
    return result;
  }

  for (const [key, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) {
      continue;
    }
    if (key === 'iam') {
      if (rawValue === null) {
        delete result.iam;
        continue;
      }
      if (typeof rawValue === 'object' && rawValue !== null) {
        const iamValue = rawValue as Record<string, unknown>;
        const readScopes = Array.isArray(iamValue.readScopes)
          ? dedupeScopes(iamValue.readScopes as string[])
          : undefined;
        const writeScopes = Array.isArray(iamValue.writeScopes)
          ? dedupeScopes(iamValue.writeScopes as string[])
          : undefined;
        const iamResult: Record<string, unknown> = {};
        if (readScopes && readScopes.length > 0) {
          iamResult.readScopes = readScopes;
        }
        if (writeScopes && writeScopes.length > 0) {
          iamResult.writeScopes = writeScopes;
        }
        if (Object.keys(iamResult).length > 0) {
          result.iam = iamResult;
        } else {
          delete result.iam;
        }
      }
      continue;
    }

    if (key === 'execution') {
      if (rawValue === null) {
        delete result.execution;
        continue;
      }
      const normalized = normalizeExecutionMetadata(rawValue);
      if (normalized) {
        result.execution = normalized;
      } else {
        delete result.execution;
      }
      continue;
    }

    result[key] = cloneJsonValue(rawValue);
  }

  return result;
}

function createAuditRequestSnapshot(body: CreateDatasetRequest, metadata: JsonObject): JsonObject {
  return {
    slug: body.slug,
    name: body.name,
    description: body.description ?? null,
    status: body.status ?? 'active',
    writeFormat: body.writeFormat ?? 'parquet',
    defaultStorageTargetId: body.defaultStorageTargetId ?? null,
    metadata: cloneJsonObject(metadata)
  } satisfies JsonObject;
}

function serializeDatasetForAudit(dataset: DatasetRecord): JsonObject {
  return {
    id: dataset.id,
    slug: dataset.slug,
    name: dataset.name,
    description: dataset.description,
    status: dataset.status,
    writeFormat: dataset.writeFormat,
    defaultStorageTargetId: dataset.defaultStorageTargetId,
    metadata: cloneJsonObject(dataset.metadata),
    updatedAt: dataset.updatedAt
  } satisfies JsonObject;
}

function datasetMatchesCreateRequest(
  dataset: DatasetRecord,
  body: CreateDatasetRequest,
  metadata: JsonObject
): boolean {
  return (
    dataset.name === body.name &&
    dataset.description === (body.description ?? null) &&
    dataset.status === (body.status ?? 'active') &&
    dataset.writeFormat === (body.writeFormat ?? 'parquet') &&
    dataset.defaultStorageTargetId === (body.defaultStorageTargetId ?? null) &&
    stableJsonStringify(dataset.metadata) === stableJsonStringify(metadata)
  );
}

function diffDatasets(before: DatasetRecord, after: DatasetRecord): string[] {
  const fields: Array<[string, (input: DatasetRecord) => unknown]> = [
    ['name', (input) => input.name],
    ['description', (input) => input.description],
    ['status', (input) => input.status],
    ['defaultStorageTargetId', (input) => input.defaultStorageTargetId],
    ['metadata', (input) => input.metadata]
  ];

  const changed: string[] = [];
  for (const [key, selector] of fields) {
    const left = selector(before);
    const right = selector(after);
    const diff = key === 'metadata' ? stableJsonStringify(left) !== stableJsonStringify(right) : left !== right;
    if (diff) {
      changed.push(key);
    }
  }
  return changed;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      result[key] = sortJson(entryValue);
    }
    return result;
  }
  return value;
}

function cloneJsonObject(source: JsonObject | undefined): JsonObject {
  const result: JsonObject = {};
  if (!source) {
    return result;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    result[key] = cloneJsonValue(value);
  }
  return result;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (entryValue === undefined) {
        continue;
      }
      result[key] = cloneJsonValue(entryValue);
    }
    return result;
  }
  return null;
}

function normalizeExecutionMetadata(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const backend = typeof raw.backend === 'string' ? raw.backend.trim() : '';
  if (!backend) {
    return null;
  }
  const normalized: JsonObject = { backend };
  const optionsValue = raw.options;
  if (optionsValue && typeof optionsValue === 'object' && !Array.isArray(optionsValue)) {
    const cloned = cloneJsonObject(optionsValue as JsonObject);
    if (Object.keys(cloned).length > 0) {
      normalized.options = cloned;
    }
  }
  return normalized;
}

function dedupeScopes(scopes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!seen.has(trimmed)) {
      result.push(trimmed);
      seen.add(trimmed);
    }
  }
  return result;
}

function encodeAuditCursor(cursor: DatasetAccessAuditCursor): string {
  const payload = JSON.stringify(cursor);
  return Buffer.from(payload, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeAuditCursor(value: string): DatasetAccessAuditCursor | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return {
        createdAt: parsed.createdAt,
        id: parsed.id
      } satisfies DatasetAccessAuditCursor;
    }
    return null;
  } catch (error) {
    return null;
  }
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
