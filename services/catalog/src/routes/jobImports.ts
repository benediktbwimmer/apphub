import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import * as tar from 'tar';
import { createJobDefinition, getJobDefinitionBySlug } from '../db/jobs';
import type { JobDefinitionCreateInput, JsonValue } from '../db/types';
import { getExampleJobBundle, isExampleJobSlug, listExampleJobBundles } from '@apphub/examples-registry';
import type { PackagedExampleBundle } from '@apphub/example-bundler';
import {
  packageExampleBundle as orchestrateExampleBundle,
  listExampleBundleStatuses,
  getExampleBundleStatus
} from '../exampleBundles/manager';
import { enqueueExampleBundleJob, type EnqueueExampleBundleResult } from '../queue';
import type { ExampleBundleJobResult } from '../exampleBundleWorker';
import type { ExampleBundleStatus } from '../exampleBundles/statusStore';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_BUNDLE_WRITE_SCOPES, JOB_BUNDLE_READ_SCOPES } from './shared/scopes';
import { publishBundleVersion } from '../jobs/registryService';
import { extractSchemasFromBundleVersion } from '../jobs/schemaIntrospector';
import { jsonValueSchema } from '../workflows/zodSchemas';
import type { BundlePublishResult } from '../jobs/registryService';

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
    .strict(),
  z
    .object({
      source: z.literal('example'),
      slug: z.string().min(1),
      reference: referenceSchema.optional(),
      notes: z.string().optional()
    })
    .strict()
]);

const loadExamplesSchema = z
  .object({
    slugs: z.array(z.string().min(1)).optional(),
    force: z.boolean().optional(),
    skipBuild: z.boolean().optional(),
    minify: z.boolean().optional()
  })
  .optional();

const enqueueExampleSchema = z
  .object({
    slug: z.string().min(1),
    force: z.boolean().optional(),
    skipBuild: z.boolean().optional(),
    minify: z.boolean().optional()
  })
  .strict();

type ExampleBundleSummary = {
  slug: string;
  version: string | null;
  checksum: string | null;
  filename: string | null;
  fingerprint: string | null;
  cached: boolean | null;
  reference: string | null;
};

type ExampleBundleJobResponse = {
  slug: string;
  jobId: string;
  mode: 'inline' | 'queued';
  status: ExampleBundleStatus | null;
  bundle: ExampleBundleSummary | null;
  result?: ExampleBundleJobResult | null;
};

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const exampleJobCache = new Map<string, JobDefinitionCreateInput | null>();

type UploadPreviewRequest = Extract<z.infer<typeof previewRequestSchema>, { source: 'upload' }>;

function normalizeExampleEntryPoint(entryPoint: string, slug: string, version: string): string {
  if (!entryPoint.startsWith('bundle:')) {
    return entryPoint;
  }
  const exportIndex = entryPoint.indexOf('#');
  const exportSuffix = exportIndex >= 0 ? entryPoint.slice(exportIndex) : '';
  const normalizedSlug = slug.trim();
  return `bundle:${normalizedSlug}@${version}${exportSuffix}`;
}

function resolveExampleJobDefinition(slug: string): JobDefinitionCreateInput | null {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  if (exampleJobCache.has(normalizedSlug)) {
    return exampleJobCache.get(normalizedSlug) ?? null;
  }
  if (!isExampleJobSlug(normalizedSlug)) {
    exampleJobCache.set(normalizedSlug, null);
    return null;
  }
  const bundle = getExampleJobBundle(normalizedSlug);
  if (!bundle) {
    exampleJobCache.set(normalizedSlug, null);
    return null;
  }
  const definition = JSON.parse(JSON.stringify(bundle.definition)) as JobDefinitionCreateInput;
  exampleJobCache.set(normalizedSlug, definition);
  return definition;
}

async function ensureExampleJobDefinition(slug: string, version: string): Promise<void> {
  const trimmedSlug = slug.trim();
  if (!trimmedSlug) {
    return;
  }
  const baseDefinition = resolveExampleJobDefinition(trimmedSlug);
  if (!baseDefinition) {
    return;
  }
  const existing = await getJobDefinitionBySlug(trimmedSlug);
  if (existing) {
    return;
  }
  const entryPoint = normalizeExampleEntryPoint(baseDefinition.entryPoint, trimmedSlug, version);
  const payload: JobDefinitionCreateInput = {
    ...baseDefinition,
    slug: trimmedSlug,
    entryPoint
  };
  try {
    await createJobDefinition(payload);
  } catch (err) {
    if (err instanceof Error && /already exists/i.test(err.message)) {
      return;
    }
    throw err;
  }
}

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

function buildExampleBundleSummary(
  slug: string,
  status: ExampleBundleStatus | null,
  result?: ExampleBundleJobResult | null
): ExampleBundleSummary | null {
  const version = result?.version ?? status?.version ?? null;
  const checksum = result?.checksum ?? status?.checksum ?? null;
  const filename = result?.filename ?? status?.filename ?? null;
  const fingerprint = result?.fingerprint ?? status?.fingerprint ?? null;
  const cachedFlag = result?.cached ?? status?.cached ?? null;

  if (!version && !checksum && !filename && !fingerprint && cachedFlag === null) {
    return null;
  }

  const reference = version ? `${slug}@${version}` : null;
  return {
    slug,
    version,
    checksum,
    filename,
    fingerprint,
    cached: cachedFlag,
    reference
  } satisfies ExampleBundleSummary;
}

function toExampleBundleJobResponse(
  job: EnqueueExampleBundleResult,
  status: ExampleBundleStatus | null
): ExampleBundleJobResponse {
  return {
    slug: job.slug,
    jobId: job.jobId,
    mode: job.mode,
    status,
    bundle: buildExampleBundleSummary(job.slug, status, job.result ?? null),
    result: job.result ?? null
  } satisfies ExampleBundleJobResponse;
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

  const manifestRecord = manifestObject;
  const manifestVersionRaw = manifestRecord.version;
  const manifestVersion = typeof manifestVersionRaw === 'string' ? manifestVersionRaw.trim() : null;
  if (!manifestVersion || manifestVersion.length === 0) {
    errors.push({ code: 'manifest_version_missing', message: 'manifest.json must include a "version" string.' });
  }

  if (!referenceVersion) {
    if (manifestVersion) {
      referenceVersion = manifestVersion;
    } else {
      errors.push({ code: 'version_required', message: 'Provide a slug@version reference when uploading bundles.' });
    }
  } else if (manifestVersion && referenceVersion && manifestVersion !== referenceVersion) {
    warnings.push({
      code: 'version_mismatch',
      message: `Reference version ${referenceVersion} does not match manifest version ${manifestVersion}. Using manifest version.`
    });
    referenceVersion = manifestVersion;
  }

  if (!referenceSlug) {
    const manifestSlug = typeof manifestRecord.slug === 'string' ? manifestRecord.slug.trim().toLowerCase() : null;
    if (manifestSlug && manifestSlug.length > 0) {
      referenceSlug = manifestSlug;
    }
  }

  if (!referenceSlug) {
    errors.push({ code: 'slug_required', message: 'Provide a bundle slug via reference (slug@version).' });
  }

  const capabilities = collectCapabilities(manifestRecord);
  const runtime = typeof manifestRecord.runtime === 'string' ? manifestRecord.runtime : null;

  return {
    slug: referenceSlug ?? 'unknown',
    version: referenceVersion ?? 'unknown',
    manifest,
    manifestObject,
    capabilities,
    runtime,
    checksum,
    buffer,
    filename: request.source === 'upload' && 'archive' in request && request.archive.filename ? request.archive.filename : 'bundle.tgz',
    contentType:
      request.source === 'upload' && 'archive' in request && request.archive.contentType
        ? request.archive.contentType
        : 'application/gzip',
    warnings,
    errors
  } satisfies UploadPreviewResult;
}

function prepareExamplePreview(
  packaged: PackagedExampleBundle,
  options: { expectedSlug: string; reference?: string }
): UploadPreviewResult {
  const warnings: JobImportWarning[] = [];
  const errors: JobImportValidationError[] = [];

  let referenceSlug: string | null = null;
  let referenceVersion: string | null = null;
  if (options.reference) {
    try {
      const parsed = parseReference(options.reference);
      referenceSlug = parsed.slug;
      referenceVersion = parsed.version;
    } catch (err) {
      errors.push({ code: 'invalid_reference', message: (err as Error).message, field: 'reference' });
    }
  }

  const manifestRecord = packaged.manifestObject;
  const manifestSlugRaw = manifestRecord.slug;
  const manifestVersionRaw = manifestRecord.version;
  const manifestSlug = typeof manifestSlugRaw === 'string' ? manifestSlugRaw.trim().toLowerCase() : null;
  const manifestVersion = typeof manifestVersionRaw === 'string' ? manifestVersionRaw.trim() : null;

  if (!manifestVersion) {
    errors.push({ code: 'manifest_version_missing', message: 'manifest.json must include a "version" string.' });
  }

  if (!referenceVersion) {
    if (manifestVersion) {
      referenceVersion = manifestVersion;
    } else {
      referenceVersion = packaged.version;
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
    } else {
      referenceSlug = packaged.slug;
    }
  } else if (manifestSlug && referenceSlug !== manifestSlug) {
    warnings.push({
      code: 'slug_mismatch',
      message: `Reference slug ${referenceSlug} does not match manifest slug ${manifestSlug}. Using manifest slug.`
    });
    referenceSlug = manifestSlug;
  }

  if (!referenceSlug) {
    errors.push({ code: 'slug_required', message: 'Bundle manifest must include a slug.' });
  }

  if (referenceSlug && referenceSlug !== packaged.slug) {
    warnings.push({
      code: 'slug_mismatch_config',
      message: `Bundle directory slug ${packaged.slug} differs from manifest slug ${referenceSlug}.`
    });
  }

  if (referenceSlug && referenceSlug !== options.expectedSlug) {
    warnings.push({
      code: 'unexpected_slug',
      message: `Example scenario requested ${options.expectedSlug}, but the bundle manifest slug is ${referenceSlug}.`
    });
  }

  const capabilities = collectCapabilities(manifestRecord);
  const runtime = typeof manifestRecord.runtime === 'string' ? manifestRecord.runtime : null;

  return {
    slug: referenceSlug ?? packaged.slug,
    version: referenceVersion ?? packaged.version,
    manifest: packaged.manifest as JsonValue,
    manifestObject: packaged.manifestObject,
    capabilities,
    runtime,
    checksum: packaged.checksum,
    buffer: packaged.buffer,
    filename: packaged.filename,
    contentType: packaged.contentType,
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
  app.post('/examples/load', async (request, reply) => {
    const bodyResult = loadExamplesSchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      reply.status(400);
      return { error: bodyResult.error.flatten() };
    }

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'examples.load',
      resource: 'examples',
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const body = bodyResult.data ?? {};
    const available = listExampleJobBundles().map((bundle) => bundle.slug);
    const availableSet = new Set(available.map((slug) => slug.toLowerCase()));
    const requested = Array.isArray(body.slugs) && body.slugs.length > 0
      ? body.slugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => availableSet.has(slug))
      : available.map((slug) => slug.toLowerCase());

    if (requested.length === 0) {
      reply.status(400);
      return { error: 'No matching example slugs provided' };
    }

    const jobs: ExampleBundleJobResponse[] = [];
    for (const slug of requested) {
      const job = await enqueueExampleBundleJob(slug, {
        force: body.force,
        skipBuild: body.skipBuild,
        minify: body.minify
      });
      const status = await getExampleBundleStatus(slug);
      jobs.push(toExampleBundleJobResponse(job, status));
    }

    reply.status(202);
    return {
      data: {
        jobs
      }
    };
  });

  app.get('/examples/bundles/status', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'examples.status',
      resource: 'examples',
      requiredScopes: JOB_BUNDLE_READ_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const statuses = await listExampleBundleStatuses();
    reply.status(200);
    return {
      data: {
        statuses
      }
    };
  });

  app.post('/job-imports/example', async (request, reply) => {
    const parseBody = enqueueExampleSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-bundles.enqueue-example',
      resource: 'job-bundles',
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const body = parseBody.data;
    const normalizedSlug = body.slug.trim().toLowerCase();
    if (!isExampleJobSlug(normalizedSlug)) {
      reply.status(400);
      return { error: `Unknown example bundle slug: ${body.slug}` };
    }

    const job = await enqueueExampleBundleJob(normalizedSlug, {
      force: body.force,
      skipBuild: body.skipBuild,
      minify: body.minify
    });
    const status = await getExampleBundleStatus(normalizedSlug);
    const response = toExampleBundleJobResponse(job, status);

    reply.status(job.mode === 'inline' ? 200 : 202);
    return {
      data: response
    };
  });

  app.get('/job-imports/example/:slug', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-bundles.example-status',
      resource: 'job-bundles',
      requiredScopes: JOB_BUNDLE_READ_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const slugParam = String((request.params as { slug?: string }).slug ?? '').trim().toLowerCase();
    if (!slugParam || !isExampleJobSlug(slugParam)) {
      reply.status(404);
      return { error: 'Example bundle not found' };
    }

    const status = await getExampleBundleStatus(slugParam);
    const bundle = buildExampleBundleSummary(slugParam, status, null);
    reply.status(200);
    return {
      data: {
        slug: slugParam,
        status,
        bundle
      }
    };
  });

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
      let parsed: UploadPreviewResult;
      if (body.source === 'upload') {
        let buffer: Buffer;
        try {
          buffer = decodeArchiveData(body.archive.data);
        } catch (err) {
          reply.status(400);
          return { error: (err as Error).message };
        }
        parsed = await prepareUploadPreview(body, buffer);
      } else {
        const packaged = await orchestrateExampleBundle(body.slug);
        parsed = prepareExamplePreview(packaged, {
          expectedSlug: body.slug,
          reference: body.reference
        });
      }
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
      let parsed: UploadPreviewResult;
      if (body.source === 'upload') {
        let buffer: Buffer;
        try {
          buffer = decodeArchiveData(body.archive.data);
        } catch (err) {
          reply.status(400);
          return { error: (err as Error).message };
        }
        parsed = await prepareUploadPreview(body, buffer);
      } else {
        const packaged = await orchestrateExampleBundle(body.slug);
        parsed = prepareExamplePreview(packaged, {
          expectedSlug: body.slug,
          reference: body.reference
        });
      }
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

      if (body.source === 'example') {
        await ensureExampleJobDefinition(publishResult.version.slug, publishResult.version.version);
      }

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
