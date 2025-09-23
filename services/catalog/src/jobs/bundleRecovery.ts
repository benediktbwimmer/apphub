import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getJobBundleVersion } from '../db/jobBundles';
import { upsertJobDefinition } from '../db/jobs';
import type { JobBundleVersionRecord, JobDefinitionRecord, JsonValue } from '../db/types';
import {
  buildBundleArtifactFromSuggestion,
  publishGeneratedBundle,
  type AiGeneratedBundleSuggestion
} from '../ai/bundlePublisher';
import { getLocalBundleArtifactPath } from './bundleStorage';

export type BundleBinding = {
  slug: string;
  version: string;
  exportName?: string | null;
};

export type BundleRecoveryParams = {
  binding: BundleBinding;
  definition: JobDefinitionRecord;
  bundleRecord: JobBundleVersionRecord | null;
  logger: (message: string, meta?: Record<string, unknown>) => void;
};

export type BundleRecoveryResult = {
  record: JobBundleVersionRecord;
  binding: BundleBinding;
};

type AiBuilderMetadata = {
  bundle?: AiGeneratedBundleSuggestion;
  prompt?: string;
  additionalNotes?: string;
  metadataSummary?: string;
  rawOutput?: string;
  stdout?: string;
  stderr?: string;
  summary?: string | null;
  lastRehydratedAt?: string;
  lastRegeneratedAt?: string;
  history?: {
    slug: string;
    version: string;
    checksum?: string;
    regeneratedAt?: string;
  }[];
  source?: string;
};

type MetadataState = {
  root: Record<string, unknown>;
  aiBuilder: AiBuilderMetadata;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

export function extractMetadata(definition: JobDefinitionRecord): MetadataState {
  const root = isPlainObject(definition.metadata) ? { ...definition.metadata } : {};
  const aiBuilderRaw = isPlainObject((root as Record<string, unknown>).aiBuilder)
    ? cloneJson((root as Record<string, unknown>).aiBuilder as JsonValue)
    : {};
  const aiBuilder: AiBuilderMetadata = isPlainObject(aiBuilderRaw)
    ? { ...(aiBuilderRaw as AiBuilderMetadata) }
    : {};
  return { root, aiBuilder };
}

function metadataEquals(a: JsonValue | null | undefined, b: JsonValue | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function persistMetadata(
  definition: JobDefinitionRecord,
  nextMetadata: Record<string, unknown>
): Promise<void> {
  if (metadataEquals(definition.metadata ?? {}, nextMetadata as JsonValue)) {
    return;
  }

  await upsertJobDefinition({
    slug: definition.slug,
    name: definition.name,
    type: definition.type,
    version: definition.version,
    runtime: definition.runtime,
    entryPoint: definition.entryPoint,
    timeoutMs: definition.timeoutMs ?? undefined,
    retryPolicy: definition.retryPolicy ?? undefined,
    parametersSchema: definition.parametersSchema ?? undefined,
    defaultParameters: definition.defaultParameters ?? undefined,
    metadata: nextMetadata as JsonValue
  });
  definition.metadata = nextMetadata as JsonValue;
}

export function cloneSuggestion(source: AiGeneratedBundleSuggestion): AiGeneratedBundleSuggestion {
  return {
    ...source,
    files: source.files.map((file) => ({ ...file }))
  } satisfies AiGeneratedBundleSuggestion;
}

function bumpVersion(version: string): string {
  const semver = /^(\d+)\.(\d+)\.(\d+)$/;
  const match = semver.exec(version.trim());
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    return `${major}.${minor}.${patch + 1}`;
  }
  const fallback = version.trim();
  if (/^\d+$/.test(fallback)) {
    return `${Number(fallback) + 1}`;
  }
  return `${fallback || '1.0.0'}+regen-${Date.now()}`;
}

export async function findNextVersion(slug: string, baseVersion: string): Promise<string> {
  let candidate = bumpVersion(baseVersion);
  let attempts = 0;
  while (attempts < 10) {
    const existing = await getJobBundleVersion(slug, candidate);
    if (!existing) {
      return candidate;
    }
    candidate = bumpVersion(candidate);
    attempts += 1;
  }
  return `${baseVersion || '1.0.0'}+regen-${Date.now()}`;
}

async function restoreArtifactFromSuggestion(
  record: JobBundleVersionRecord,
  suggestion: AiGeneratedBundleSuggestion,
  options: { strictChecksum?: boolean } = {}
): Promise<boolean> {
  if (record.artifactStorage !== 'local') {
    return false;
  }
  const strictChecksum = options.strictChecksum ?? true;

  const prepared = await buildBundleArtifactFromSuggestion(suggestion, {
    slug: record.slug,
    version: record.version,
    entryPoint: suggestion.entryPoint
  });

  if (prepared.artifact.checksum !== record.checksum && strictChecksum) {
    return false;
  }

  const targetPath = getLocalBundleArtifactPath(record);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, prepared.artifact.data);
  return true;
}

async function publishNewBundleVersion(
  definition: JobDefinitionRecord,
  existingRecord: JobBundleVersionRecord | null,
  suggestion: AiGeneratedBundleSuggestion,
  logger: (message: string, meta?: Record<string, unknown>) => void,
  binding: BundleBinding
): Promise<BundleRecoveryResult | null> {
  const baseVersion = existingRecord?.version ?? suggestion.version;
  const nextVersion = await findNextVersion(binding.slug, baseVersion);
  const nextSuggestion = cloneSuggestion(suggestion);
  nextSuggestion.slug = binding.slug;
  nextSuggestion.version = nextVersion;

  const result = await publishGeneratedBundle(nextSuggestion, {
    subject: 'system',
    kind: 'job-runtime'
  });

  logger('Published regenerated job bundle version', {
    slug: result.version.slug,
    version: result.version.version,
    checksum: result.version.checksum
  });

  const entryPoint = `bundle:${result.version.slug}@${result.version.version}`;
  const metadataState = extractMetadata(definition);
  metadataState.aiBuilder.bundle = cloneSuggestion(nextSuggestion);
  metadataState.aiBuilder.lastRegeneratedAt = new Date().toISOString();
  metadataState.aiBuilder.history = [
    ...(metadataState.aiBuilder.history ?? []),
    {
      slug: result.version.slug,
      version: result.version.version,
      checksum: result.version.checksum,
      regeneratedAt: metadataState.aiBuilder.lastRegeneratedAt
    }
  ];
  metadataState.aiBuilder.source = metadataState.aiBuilder.source ?? 'regenerated';
  metadataState.root.aiBuilder = metadataState.aiBuilder;

  await upsertJobDefinition({
    slug: definition.slug,
    name: definition.name,
    type: definition.type,
    version: definition.version,
    runtime: definition.runtime,
    entryPoint,
    timeoutMs: definition.timeoutMs ?? undefined,
    retryPolicy: definition.retryPolicy ?? undefined,
    parametersSchema: definition.parametersSchema ?? undefined,
    defaultParameters: definition.defaultParameters ?? undefined,
    metadata: metadataState.root as JsonValue
  });

  definition.entryPoint = entryPoint;
  definition.metadata = metadataState.root as JsonValue;

  return {
    record: result.version,
    binding: {
      slug: result.version.slug,
      version: result.version.version,
      exportName: binding.exportName ?? null
    }
  } satisfies BundleRecoveryResult;
}

function selectSuggestion(
  definition: JobDefinitionRecord,
  _binding: BundleBinding
): AiGeneratedBundleSuggestion | null {
  const metadataState = extractMetadata(definition);
  if (metadataState.aiBuilder.bundle) {
    return cloneSuggestion(metadataState.aiBuilder.bundle);
  }
  return null;
}

export type BundleRecoveryOptions = {
  allowPublish?: boolean;
  strictChecksum?: boolean;
};

export async function attemptBundleRecovery(
  params: BundleRecoveryParams,
  options: BundleRecoveryOptions = {}
): Promise<BundleRecoveryResult | null> {
  const { binding, definition, bundleRecord, logger } = params;
  const allowPublish = options.allowPublish ?? true;
  const strictChecksum = options.strictChecksum ?? true;

  const suggestion = selectSuggestion(definition, binding);
  if (!suggestion) {
    logger('Unable to regenerate bundle: no AI builder suggestion available', {
      jobSlug: definition.slug,
      bundleSlug: binding.slug,
      bundleVersion: binding.version
    });
    return null;
  }

  if (bundleRecord) {
    try {
      const restored = await restoreArtifactFromSuggestion(bundleRecord, suggestion, {
        strictChecksum
      });
      if (restored) {
        const metadataState = extractMetadata(definition);
        metadataState.aiBuilder.bundle = cloneSuggestion(suggestion);
        metadataState.aiBuilder.lastRehydratedAt = new Date().toISOString();
        metadataState.aiBuilder.history = [
          ...(metadataState.aiBuilder.history ?? []),
          {
            slug: bundleRecord.slug,
            version: bundleRecord.version,
            checksum: bundleRecord.checksum,
            regeneratedAt: metadataState.aiBuilder.lastRehydratedAt
          }
        ];
        metadataState.aiBuilder.source = metadataState.aiBuilder.source ?? 'restored';
        metadataState.root.aiBuilder = metadataState.aiBuilder;
        await persistMetadata(definition, metadataState.root);
        logger('Regenerated missing job bundle artifact from stored suggestion', {
          jobSlug: definition.slug,
          bundleSlug: bundleRecord.slug,
          bundleVersion: bundleRecord.version
        });
        return { record: bundleRecord, binding } satisfies BundleRecoveryResult;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger('Failed to rebuild bundle artifact from stored suggestion', {
        jobSlug: definition.slug,
        bundleSlug: bundleRecord.slug,
        bundleVersion: bundleRecord.version,
        error: message
      });
    }
  }

  if (!allowPublish) {
    return null;
  }

  try {
    const result = await publishNewBundleVersion(
      definition,
      bundleRecord,
      suggestion,
      logger,
      binding
    );
    if (result) {
      return result;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger('Failed to publish regenerated bundle version', {
      jobSlug: definition.slug,
      bundleSlug: binding.slug,
      bundleVersion: binding.version,
      error: message
    });
  }

  return null;
}
