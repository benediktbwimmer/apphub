import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listBundles as listJobBundles,
  getBundle,
  getBundleWithVersions,
  getBundleVersionWithDownload,
  publishBundleVersion,
  updateBundleVersion
} from '../jobs/registryService';
import {
  ensureLocalBundleExists,
  openLocalBundleArtifact,
  verifyLocalBundleDownload
} from '../jobs/bundleStorage';
import { getJobBundleVersion } from '../db/index';
import {
  serializeJobBundle,
  serializeJobBundleVersion,
  type JsonValue
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_BUNDLE_WRITE_SCOPES } from './shared/scopes';
import { jsonValueSchema } from '../workflows/zodSchemas';

const MAX_BUNDLE_ARTIFACT_BYTES = Number(process.env.APPHUB_JOB_BUNDLE_MAX_SIZE ?? 16 * 1024 * 1024);

const jobBundleManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    entry: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    metadata: jsonValueSchema.optional()
  })
  .passthrough();

const jobBundleArtifactSchema = z
  .object({
    data: z.string().min(1),
    filename: z.string().min(1).max(256).optional(),
    contentType: z.string().min(1).max(256).optional(),
    checksum: z.string().min(32).max(128).optional()
  })
  .strict();

const jobBundlePublishSchema = z
  .object({
    slug: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
    manifest: jobBundleManifestSchema,
    capabilityFlags: z.array(z.string().min(1)).optional(),
    immutable: z.boolean().optional(),
    metadata: jsonValueSchema.optional(),
    description: z.string().optional(),
    displayName: z.string().optional(),
    artifact: jobBundleArtifactSchema
  })
  .strict();

const jobBundleUpdateSchema = z
  .object({
    deprecated: z.boolean().optional(),
    metadata: jsonValueSchema.nullable().optional()
  })
  .refine((payload) => payload.deprecated !== undefined || payload.metadata !== undefined, {
    message: 'At least one field must be provided'
  });

function decodeBundleArtifactData(encoded: string): Buffer {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error('Artifact data is required');
  }
  const match = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  const payload = (match ? match[1] : trimmed).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) {
    throw new Error('Artifact data must be base64 encoded');
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = paddingNeeded > 0 ? `${normalized}${'='.repeat(paddingNeeded)}` : normalized;
  const buffer = Buffer.from(padded, 'base64');
  if (buffer.length === 0) {
    throw new Error('Artifact data is empty');
  }
  if (buffer.length > MAX_BUNDLE_ARTIFACT_BYTES) {
    throw new Error(`Artifact exceeds maximum allowed size of ${MAX_BUNDLE_ARTIFACT_BYTES} bytes`);
  }
  return buffer;
}

function sanitizeDownloadFilename(value: string | undefined, version: string): string {
  const fallbackStem = `bundle-${version}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const fallback = `${fallbackStem || 'bundle'}.tgz`;
  if (!value) {
    return fallback;
  }
  const cleaned = value.trim().replace(/[/\\]/g, '');
  if (!cleaned) {
    return fallback;
  }
  const sanitized = cleaned
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!sanitized) {
    return fallback;
  }
  return sanitized.length > 128 ? sanitized.slice(0, 128) : sanitized;
}

export async function registerJobBundleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-bundles', async (request, reply) => {
    try {
      const bundles = await listJobBundles();
      reply.status(200);
      return { data: bundles.map((bundle) => serializeJobBundle(bundle)) };
    } catch (err) {
      request.log.error({ err }, 'Failed to list job bundles');
      reply.status(500);
      return { error: 'Failed to list job bundles' };
    }
  });

  app.get('/job-bundles/:slug', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    try {
      const bundle = await getBundleWithVersions(parseParams.data.slug);
      if (!bundle) {
        reply.status(404);
        return { error: 'job bundle not found' };
      }
      reply.status(200);
      return { data: serializeJobBundle(bundle, { includeVersions: true }) };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug }, 'Failed to load job bundle');
      reply.status(500);
      return { error: 'Failed to load job bundle' };
    }
  });

  app.post('/job-bundles', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-bundles.publish',
      resource: 'job-bundles',
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = jobBundlePublishSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;

    if (typeof payload.manifest.version === 'string' && payload.manifest.version !== payload.version) {
      reply.status(400);
      const error = 'manifest.version must match the bundle version';
      await authResult.auth.log('failed', {
        reason: 'version_mismatch',
        message: error,
        slug: payload.slug,
        version: payload.version
      });
      return { error };
    }

    let artifactBuffer: Buffer;
    try {
      artifactBuffer = decodeBundleArtifactData(payload.artifact.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid artifact payload';
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_artifact',
        message,
        slug: payload.slug,
        version: payload.version
      });
      return { error: message };
    }

    const manifestCapabilitiesValue = (payload.manifest as { capabilities?: unknown }).capabilities;
    const manifestCapabilities = Array.isArray(manifestCapabilitiesValue)
      ? manifestCapabilitiesValue
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];

    const capabilityFlags = Array.from(
      new Set([...(payload.capabilityFlags ?? []), ...manifestCapabilities].map((entry) => entry.trim()).filter((entry) => entry.length > 0))
    );

    const manifestPayload = payload.manifest as JsonValue;

    try {
      const result = await publishBundleVersion(
        {
          slug: payload.slug,
          version: payload.version,
          manifest: manifestPayload,
          capabilityFlags,
          immutable: payload.immutable ?? false,
          metadata: payload.metadata ?? null,
          description: payload.description ?? null,
          displayName: payload.displayName ?? null,
          artifact: {
            data: artifactBuffer,
            filename: payload.artifact.filename ?? null,
            contentType: payload.artifact.contentType ?? null,
            checksum: payload.artifact.checksum ?? null
          }
        },
        {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        }
      );

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'publish_bundle_version',
        slug: result.bundle.slug,
        version: result.version.version,
        storage: result.version.artifactStorage
      });
      return {
        data: {
          bundle: serializeJobBundle(result.bundle),
          version: serializeJobBundleVersion(result.version, {
            includeManifest: true,
            download: result.download
          })
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish job bundle version';
      const isConflict = /already exists/i.test(message);
      const isChecksumMismatch = /checksum mismatch/i.test(message);
      const status = isConflict ? 409 : isChecksumMismatch ? 400 : 500;
      request.log.error({ err, slug: payload.slug, version: payload.version }, 'Failed to publish job bundle version');
      reply.status(status);
      await authResult.auth.log('failed', {
        reason: isConflict ? 'duplicate_version' : isChecksumMismatch ? 'checksum_mismatch' : 'exception',
        message,
        slug: payload.slug,
        version: payload.version
      });
      return { error: status === 500 ? 'Failed to publish job bundle version' : message };
    }
  });

  app.get('/job-bundles/:slug/versions/:version', async (request, reply) => {
    const parseParams = z
      .object({ slug: z.string().min(1), version: z.string().min(1) })
      .safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    try {
      const result = await getBundleVersionWithDownload(parseParams.data.slug, parseParams.data.version);
      if (!result) {
        reply.status(404);
        return { error: 'job bundle version not found' };
      }
      reply.status(200);
      return {
        data: {
          bundle: serializeJobBundle(result.bundle),
          version: serializeJobBundleVersion(result.version, {
            includeManifest: true,
            download: result.download
          })
        }
      };
    } catch (err) {
      request.log.error(
        { err, slug: parseParams.data.slug, version: parseParams.data.version },
        'Failed to load job bundle version'
      );
      reply.status(500);
      return { error: 'Failed to load job bundle version' };
    }
  });

  app.patch('/job-bundles/:slug/versions/:version', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';
    const candidateVersion = typeof rawParams?.version === 'string' ? rawParams.version : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-bundles.update',
      resource: `job-bundle:${candidateSlug}@${candidateVersion}`,
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = z
      .object({ slug: z.string().min(1), version: z.string().min(1) })
      .safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = jobBundleUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    try {
      const updateInput: { deprecated?: boolean; metadata?: JsonValue | null } = {};
      if (parseBody.data.deprecated !== undefined) {
        updateInput.deprecated = parseBody.data.deprecated;
      }
      if (Object.prototype.hasOwnProperty.call(parseBody.data, 'metadata')) {
        updateInput.metadata = parseBody.data.metadata ?? null;
      }

      const updated = await updateBundleVersion(parseParams.data.slug, parseParams.data.version, updateInput);
      if (!updated) {
        reply.status(404);
        await authResult.auth.log('failed', {
          reason: 'not_found',
          slug: parseParams.data.slug,
          version: parseParams.data.version
        });
        return { error: 'job bundle version not found' };
      }

      const latest = await getBundleVersionWithDownload(parseParams.data.slug, parseParams.data.version);
      const responseBundle = latest?.bundle ?? (await getBundle(parseParams.data.slug));
      const responseVersion = latest?.version ?? updated;
      const downloadInfo = latest?.download ?? null;

      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'update_bundle_version',
        slug: parseParams.data.slug,
        version: parseParams.data.version,
        status: updated.status
      });
      return {
        data: {
          bundle: responseBundle ? serializeJobBundle(responseBundle) : null,
          version: serializeJobBundleVersion(responseVersion, {
            includeManifest: true,
            download: downloadInfo
          })
        }
      };
    } catch (err) {
      request.log.error(
        { err, slug: parseParams.data.slug, version: parseParams.data.version },
        'Failed to update job bundle version'
      );
      reply.status(500);
      await authResult.auth.log('failed', {
        reason: 'exception',
        message: err instanceof Error ? err.message : 'unknown error',
        slug: parseParams.data.slug,
        version: parseParams.data.version
      });
      return { error: 'Failed to update job bundle version' };
    }
  });

  app.get('/job-bundles/:slug/versions/:version/download', async (request, reply) => {
    const parseParams = z
      .object({ slug: z.string().min(1), version: z.string().min(1) })
      .safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const bundleVersion = await getJobBundleVersion(parseParams.data.slug, parseParams.data.version);
    if (!bundleVersion) {
      reply.status(404);
      return { error: 'job bundle version not found' };
    }

    if (bundleVersion.artifactStorage === 's3') {
      reply.status(400);
      return { error: 's3-backed artifacts must be downloaded via the provided signed URL' };
    }

    const parseQuery = z
      .object({
        expires: z.string().min(1),
        token: z.string().min(1),
        filename: z.string().min(1).max(256).optional()
      })
      .safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const expiresAt = Number(parseQuery.data.expires);
    if (!Number.isFinite(expiresAt)) {
      reply.status(400);
      return { error: 'invalid expires value' };
    }

    if (!verifyLocalBundleDownload(bundleVersion, parseQuery.data.token, expiresAt)) {
      reply.status(403);
      return { error: 'invalid or expired download token' };
    }

    try {
      await ensureLocalBundleExists(bundleVersion);
      const stream = await openLocalBundleArtifact(bundleVersion);
      const filename = sanitizeDownloadFilename(parseQuery.data.filename, bundleVersion.version);
      if (bundleVersion.artifactSize !== null) {
        reply.header('Content-Length', String(bundleVersion.artifactSize));
      }
      reply.header('Content-Type', bundleVersion.artifactContentType ?? 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Cache-Control', 'no-store');
      reply.status(200);
      return reply.send(stream);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to open artifact';
      request.log.error(
        { err, slug: parseParams.data.slug, version: parseParams.data.version },
        'Failed to stream bundle artifact'
      );
      reply.status(404);
      return { error: message };
    }
  });
}
