import path from 'node:path';
import { ensureDatabase } from './db/init';
import { initializeServiceRegistry } from './serviceRegistry';
import { previewServiceConfigImport } from './serviceConfigLoader';
import {
  applyPlaceholderValuesToManifest,
  buildBootstrapContext,
  updatePlaceholderSummaries
} from './serviceManifestHelpers';

export type ServiceRegistryBackfillTarget = {
  moduleId?: string;
  path?: string;
  repo?: string;
  image?: string;
  ref?: string;
  commit?: string;
  configPath?: string;
  variables?: Record<string, string>;
};

export type ServiceRegistryBackfillOptions = {
  targets: ServiceRegistryBackfillTarget[];
  skipBootstrap?: boolean;
};

export type ServiceRegistryBackfillResult = {
  moduleId: string;
  servicesApplied: number;
  networksApplied: number;
  moduleVersion: string;
};

function normalizePath(specifier: string | undefined): string | undefined {
  if (!specifier) {
    return undefined;
  }
  if (path.isAbsolute(specifier)) {
    return specifier;
  }
  return path.resolve(process.cwd(), specifier);
}

function buildPreviewRequest(target: ServiceRegistryBackfillTarget) {
  const normalizedPath = normalizePath(target.path);
  return {
    path: normalizedPath,
    configPath: target.configPath,
    repo: target.repo,
    image: target.image,
    ref: target.ref,
    commit: target.commit,
    module: target.moduleId,
    variables: target.variables,
    requirePlaceholderValues: false
  } as const;
}

function ensureNoPlaceholderConflicts(
  preview: Awaited<ReturnType<typeof previewServiceConfigImport>>
): void {
  const conflicts = preview.placeholders.filter((placeholder) => placeholder.conflicts.length > 0);
  if (conflicts.length > 0) {
    const names = conflicts.map((entry) => entry.name).join(', ');
    throw new Error(`Placeholder conflicts detected: ${names}`);
  }
  const missing = preview.placeholders.filter((placeholder) => placeholder.missing);
  if (missing.length > 0) {
    const names = missing.map((entry) => entry.name).join(', ');
    throw new Error(`Missing required placeholder values: ${names}`);
  }
}

export async function backfillServiceRegistry(
  options: ServiceRegistryBackfillOptions
): Promise<ServiceRegistryBackfillResult[]> {
  if (!options.targets || options.targets.length === 0) {
    throw new Error('At least one backfill target must be provided');
  }

  const previousBootstrapFlag = process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP;
  if (options.skipBootstrap !== false) {
    process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP = '1';
  }

  await ensureDatabase();
  const registry = await initializeServiceRegistry({ enablePolling: false });
  const results: ServiceRegistryBackfillResult[] = [];

  try {
    for (const target of options.targets) {
      const previewRequest = buildPreviewRequest(target);
      const preview = await previewServiceConfigImport(previewRequest);

      if (preview.errors.length > 0) {
        const messages = preview.errors.map((entry) => `${entry.source ?? 'manifest'}: ${entry.error.message}`);
        throw new Error(`Failed to load service manifest module: ${messages.join('; ')}`);
      }

      ensureNoPlaceholderConflicts(preview);

      const { placeholders } = buildBootstrapContext(preview, target.variables);
      updatePlaceholderSummaries(preview.placeholders, placeholders);
      applyPlaceholderValuesToManifest(preview.placeholders, preview.entries, preview.networks, placeholders);

      const importResult = await registry.importManifestModule({
        moduleId: preview.moduleId,
        entries: preview.entries,
        networks: preview.networks
      });

      results.push({
        moduleId: preview.moduleId,
        servicesApplied: importResult.servicesApplied,
        networksApplied: importResult.networksApplied,
        moduleVersion: importResult.moduleVersion
      });
    }

    return results;
  } finally {
    registry.stop();
    if (options.skipBootstrap !== false) {
      if (previousBootstrapFlag === undefined) {
        delete process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP;
      } else {
        process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP = previousBootstrapFlag;
      }
    }
  }
}

export async function backfillServiceRegistryFromPaths(
  paths: string[]
): Promise<ServiceRegistryBackfillResult[]> {
  const targets = paths.map((entry) => ({ path: entry } satisfies ServiceRegistryBackfillTarget));
  return backfillServiceRegistry({ targets });
}

export function formatBackfillResult(result: ServiceRegistryBackfillResult): string {
  return `Module ${result.moduleId}@${result.moduleVersion}: ${result.servicesApplied} services, ${result.networksApplied} networks`;
}
