import { logger } from '../observability/logger';
import { loadBundleEditorSnapshot, parseBundleEntryPoint } from '../jobs/bundleEditor';
import type { JobDefinitionRecord, JsonValue } from '../db/types';

export type AiBundleContext = {
  slug: string;
  version: string;
  entryPoint: string;
  manifest: JsonValue;
  manifestPath?: string | null;
  capabilityFlags: string[];
  metadata?: JsonValue | null;
  description?: string | null;
  displayName?: string | null;
  files: Array<{
    path: string;
    contents: string;
    encoding?: 'utf8' | 'base64';
    executable?: boolean;
  }>;
  jobSlugs: string[];
};

type BundleGrouping = {
  bindingSlug: string;
  bindingVersion: string;
  representativeJob: JobDefinitionRecord;
  jobSlugs: string[];
};

function groupJobsByBundle(jobs: ReadonlyArray<JobDefinitionRecord>): Map<string, BundleGrouping> {
  const groups = new Map<string, BundleGrouping>();
  for (const job of jobs) {
    if (job.runtime !== 'node') {
      continue;
    }
    const binding = parseBundleEntryPoint(job.entryPoint);
    if (!binding) {
      continue;
    }
    const key = `${binding.slug}@${binding.version}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobSlugs.push(job.slug);
      continue;
    }
    groups.set(key, {
      bindingSlug: binding.slug,
      bindingVersion: binding.version,
      representativeJob: job,
      jobSlugs: [job.slug]
    });
  }
  return groups;
}

export async function collectBundleContexts(
  jobs: ReadonlyArray<JobDefinitionRecord>
): Promise<AiBundleContext[]> {
  const groups = groupJobsByBundle(jobs);
  if (groups.size === 0) {
    return [];
  }

  const contexts: AiBundleContext[] = [];

  await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      try {
        const snapshot = await loadBundleEditorSnapshot(group.representativeJob);
        if (!snapshot) {
          return;
        }
        const suggestion = snapshot.suggestion;
        contexts.push({
          slug: snapshot.binding.slug,
          version: snapshot.binding.version,
          entryPoint: suggestion.entryPoint,
          manifest: suggestion.manifest,
          manifestPath: suggestion.manifestPath ?? undefined,
          capabilityFlags: suggestion.capabilityFlags ?? [],
          metadata: suggestion.metadata ?? null,
          description: suggestion.description ?? null,
          displayName: suggestion.displayName ?? null,
          files: suggestion.files.map((file) => ({ ...file })),
          jobSlugs: [...group.jobSlugs]
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to load bundle context for AI builder', {
          bundleSlug: group.bindingSlug,
          bundleVersion: group.bindingVersion,
          error: message
        });
      }
    })
  );

  return contexts;
}
