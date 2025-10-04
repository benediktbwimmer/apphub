import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import * as tar from 'tar';
import type { JsonValue } from '../db/types';
import { publishBundleVersion, type BundlePublishResult } from '../jobs/registryService';
import { extractSchemasFromBundleVersion } from '../jobs/schemaIntrospector';
import { jsonValueSchema } from '../workflows/zodSchemas';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_BUNDLE_WRITE_SCOPES } from './shared/scopes';

const BASE64_DATA_PREFIX = /^data:[^;]+;base64,/i;

const referenceSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9][a-z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9._-]*$/i, 'Reference must be formatted as slug@version');

const uploadArchiveSchema = z.object({
  data: z.string().min(1),
  filename: z.string().optional(),
  contentType: z.string().optional()
});

const previewRequestSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('upload'),
      archive: uploadArchiveSchema,
      reference: referenceSchema.optional(),
      notes: z.string().optional()
    })
    .strict(),
  z
    .object({
      source: z.literal('registry'),
      reference: referenceSchema,
      notes: z.string().optional()
    })
    .strict()
]);

type JobImportWarning = {
  code?: string;
  message: string;
};

type JobImportValidationError = {
  code?: string;
  message: string;
  field?: string;
};

type UploadPreviewResult = {
  slug: string;
  version: string;
  manifest: JsonValue;
  manifestObject: Record<string, JsonValue>;
  capabilities: string[];
  runtime: string | null;
  checksum: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  warnings: JobImportWarning[];
  errors: JobImportValidationError[];
};

type UploadPreviewRequest = Extract<z.infer<typeof previewRequestSchema>, { source: 'upload' }>;

function normalizeBase64Input(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Archive data is required');
  }
  const withoutPrefix = trimmed.replace(BASE64_DATA_PREFIX, '');
  return withoutPrefix.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
}

function decodeArchiveData(encoded: string): Buffer {
  const normalized = normalizeBase64Input(encoded);
  const paddingNeeded = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = paddingNeeded > 0 ? `${normalized}${'='.repeat(paddingNeeded)}` : normalized;
  const buffer = Buffer.from(padded, 'base64');
  if (buffer.length === 0) {
    throw new Error('Archive data is empty or invalid');
  }
  return buffer;
}

function parseReference(value: string): { slug: string; version: string } {
  const match = referenceSchema.safeParse(value);
  if (!match.success) {
    throw new Error(match.error.errors[0]?.message ?? 'Invalid reference value');
  }
  const [slugPart, versionPart] = match.data.split('@');
  return { slug: slugPart.toLowerCase(), version: versionPart };
}

async function extractManifestFromArchive(buffer: Buffer): Promise<{ manifest: JsonValue; manifestObject: Record<string, JsonValue> }>
{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-job-import-'));
  try {
    const archivePath = path.join(tempRoot, 'bundle.tgz');
    await fs.writeFile(archivePath, buffer);
    await tar.x({ file: archivePath, cwd: tempRoot });
    const manifestPath = path.join(tempRoot, 'manifest.json');
    let manifestRaw: unknown;
    try {
      const contents = await fs.readFile(manifestPath, 'utf8');
      manifestRaw = JSON.parse(contents);
    } catch (err) {
      throw new Error('Bundle is missing manifest.json at the root');
    }
    const manifest = jsonValueSchema.parse(manifestRaw);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Bundle manifest must be a JSON object');
    }
    return { manifest, manifestObject: manifest as Record<string, JsonValue> };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function collectCapabilities(manifest: Record<string, JsonValue>): string[] {
  const raw = manifest.capabilities;
  if (!Array.isArray(raw)) {
    return [];
  }
  const set = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
  return Array.from(set);
}

function computeChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function buildPreviewResponse(
  parsed: UploadPreviewResult,
  schemaSource?: { parametersSchema: JsonValue | null }
): JsonValue {
  const bundle: Record<string, JsonValue> = {
    slug: parsed.slug,
    version: parsed.version,
    description:
      typeof parsed.manifestObject.description === 'string' ? parsed.manifestObject.description : null,
    runtime: typeof parsed.manifestObject.runtime === 'string' ? parsed.manifestObject.runtime : null,
    capabilities: parsed.capabilities,
    checksum: parsed.checksum
  };

  if (schemaSource?.parametersSchema !== null && schemaSource?.parametersSchema !== undefined) {
    bundle.parameters = { schema: schemaSource.parametersSchema } as JsonValue;
  }

  const warnings = parsed.warnings.map((warning) => ({
    code: warning.code ?? null,
    message: warning.message
  } satisfies Record<string, JsonValue>));

  const errors = parsed.errors.map((error) => ({
    code: error.code ?? null,
    message: error.message,
    field: error.field ?? null
  } satisfies Record<string, JsonValue>));

  return {
    bundle,
    warnings,
    errors
  } satisfies JsonValue;
}

async function prepareUploadPreview(
  request: UploadPreviewRequest,
  buffer: Buffer
): Promise<UploadPreviewResult> {
  const { manifest, manifestObject } = await extractManifestFromArchive(buffer);
  const checksum = computeChecksum(buffer);
  const warnings: JobImportWarning[] = [];
  const errors: JobImportValidationError[] = [];

  let referenceSlug: string | null = null;
  let referenceVersion: string | null = null;
  if (request.reference) {
    try {
      const parsed = parseReference(request.reference);
      referenceSlug = parsed.slug;
      referenceVersion = parsed.version;
    } catch (err) {
      errors.push({ code: 'invalid_reference', message: (err as Error).message, field: 'reference' });
    }
  }

  const manifestSlug =
    typeof manifestObject.slug === 'string' && manifestObject.slug.trim().length > 0
      ? manifestObject.slug.trim().toLowerCase()
      : null;
  const manifestVersion =
    typeof manifestObject.version === 'string' && manifestObject.version.trim().length > 0
      ? manifestObject.version.trim()
      : null;

  if (!manifestVersion) {
    errors.push({ code: 'manifest_version_missing', message: 'manifest.json must include a "version" string.' });
  }

  if (!referenceVersion) {
    if (manifestVersion) {
      referenceVersion = manifestVersion;
    }
  } else if (manifestVersion && referenceVersion !== manifestVersion) {
    warnings.push({
      code: 'version_mismatch',
      message: `Reference version ${referenceVersion} does not match manifest version ${manifestVersion}. Using manifest version.`
    });
    referenceVersion = manifestVersion;
  }

  if (!referenceSlug) {
    if (manifestSlug) {
      referenceSlug = manifestSlug;
    }
  }

  if (!referenceSlug) {
    errors.push({ code: 'slug_required', message: 'Provide a bundle slug via reference (slug@version).' });
  }

  const capabilities = collectCapabilities(manifestObject);
  const runtime = typeof manifestObject.runtime === 'string' ? manifestObject.runtime : null;
  const filename = request.archive.filename?.trim() || `${referenceSlug ?? 'bundle'}-${referenceVersion ?? 'latest'}.tgz`;
  const contentType = request.archive.contentType ?? 'application/gzip';

  return {
    slug: referenceSlug ?? 'unknown',
    version: referenceVersion ?? 'unknown',
    manifest,
    manifestObject,
    capabilities,
    runtime,
    checksum,
    buffer,
    filename,
    contentType,
    warnings,
    errors
  } satisfies UploadPreviewResult;
}

function buildConfirmResponse(result: BundlePublishResult, runtime: string | null, capabilities: string[]): JsonValue {
  return {
    job: {
      id: result.version.id,
      slug: result.bundle.slug,
      version: result.version.version,
      runtime,
      capabilities,
      createdAt: result.version.createdAt
    },
    nextSteps: {}
  } satisfies JsonValue;
}

export async function registerJobImportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/job-imports/preview', { config: { bodyLimit: 8 * 1024 * 1024 } }, async (request, reply) => {
    const parseBody = previewRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-bundles.import.preview',
      resource: 'job-bundles',
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const body = parseBody.data;
    if (body.source === 'registry') {
      reply.status(501);
      return { error: 'Registry preview is not implemented yet.' };
    }

    try {
      let buffer: Buffer;
      try {
        buffer = decodeArchiveData(body.archive.data);
      } catch (err) {
        reply.status(400);
        return { error: (err as Error).message };
      }

      const parsed = await prepareUploadPreview(body, buffer);
      const schemaPreview = extractSchemasFromBundleVersion({ manifest: parsed.manifestObject });
      reply.status(200);
      return {
        data: buildPreviewResponse(parsed, {
          parametersSchema: schemaPreview.parametersSchema
        })
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to preview job bundle import');
      reply.status(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/job-imports', { config: { bodyLimit: 8 * 1024 * 1024 } }, async (request, reply) => {
    const parseBody = previewRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-bundles.import',
      resource: 'job-bundles',
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const body = parseBody.data;
    if (body.source === 'registry') {
      reply.status(501);
      return { error: 'Registry imports are not supported yet.' };
    }

    try {
      let buffer: Buffer;
      try {
        buffer = decodeArchiveData(body.archive.data);
      } catch (err) {
        reply.status(400);
        return { error: (err as Error).message };
      }

      const parsed = await prepareUploadPreview(body, buffer);
      if (parsed.errors.length > 0) {
        reply.status(400);
        return { error: parsed.errors.map((item) => item.message).join('\n') };
      }

      let metadata: JsonValue | null = parsed.manifestObject.metadata ?? null;
      if (body.notes && body.notes.trim()) {
        const base: Record<string, JsonValue> = {};
        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
          Object.assign(base, metadata as Record<string, JsonValue>);
        }
        base.importNotes = body.notes.trim();
        metadata = base as JsonValue;
      }

      const publishResult = await publishBundleVersion(
        {
          slug: parsed.slug,
          version: parsed.version,
          manifest: parsed.manifest,
          capabilityFlags: parsed.capabilities,
          description: typeof parsed.manifestObject.description === 'string' ? parsed.manifestObject.description : null,
          displayName: typeof parsed.manifestObject.name === 'string' ? parsed.manifestObject.name : null,
          metadata,
          artifact: {
            data: parsed.buffer,
            filename: parsed.filename ?? `${parsed.slug}-${parsed.version}.tgz`,
            contentType: parsed.contentType ?? 'application/gzip',
            checksum: parsed.checksum
          }
        },
        {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        }
      );

      reply.status(201);
      return {
        data: buildConfirmResponse(publishResult, parsed.runtime, parsed.capabilities)
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to import job bundle');
      reply.status(400);
      return { error: (err as Error).message };
    }
  });
}
