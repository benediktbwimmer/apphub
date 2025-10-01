import type { LoadedManifestEntry, LoadedServiceNetwork } from './serviceConfigLoader';
import type { ResolvedManifestEnvVar } from './serviceManifestTypes';
import { previewServiceConfigImport } from './serviceConfigLoader';

type ManifestImportPreview = Awaited<ReturnType<typeof previewServiceConfigImport>>;

type PlaceholderMap = Map<string, string>;

type PlaceholderSummaries = ManifestImportPreview['placeholders'];

type PlaceholderValues = PlaceholderMap;

export function buildBootstrapContext(
  preview: ManifestImportPreview,
  variables: Record<string, string> | undefined
): { placeholders: PlaceholderMap; variables: Record<string, string> } {
  const resolvedVariables: Record<string, string> = { ...(variables ?? {}) };
  const placeholders: PlaceholderMap = new Map();

  for (const placeholder of preview.placeholders) {
    if (placeholder.value === undefined) {
      continue;
    }
    placeholders.set(placeholder.name, placeholder.value);
    if (!(placeholder.name in resolvedVariables)) {
      resolvedVariables[placeholder.name] = placeholder.value;
    }
  }

  for (const [key, value] of Object.entries(resolvedVariables)) {
    if (!placeholders.has(key) && typeof value === 'string') {
      placeholders.set(key, value);
    }
  }

  return { placeholders, variables: resolvedVariables };
}

export function updatePlaceholderSummaries(
  summaries: PlaceholderSummaries,
  values: PlaceholderValues
): void {
  for (const summary of summaries) {
    const resolved = values.get(summary.name);
    if (resolved === undefined) {
      continue;
    }
    summary.value = resolved;
    summary.missing = false;
  }
}

function updateEnvVarValue(env: ResolvedManifestEnvVar[] | undefined, key: string, value: string): void {
  if (!env) {
    return;
  }
  for (const entry of env) {
    if (entry.key === key) {
      entry.value = value;
    }
  }
}

export function applyPlaceholderValuesToManifest(
  summaries: PlaceholderSummaries,
  entries: LoadedManifestEntry[],
  networks: LoadedServiceNetwork[],
  values: PlaceholderValues
): void {
  if (summaries.length === 0 || values.size === 0) {
    return;
  }

  const serviceMap = new Map<string, LoadedManifestEntry>();
  for (const entry of entries) {
    serviceMap.set(entry.slug, entry);
  }

  const networkMap = new Map<string, LoadedServiceNetwork>();
  for (const network of networks) {
    networkMap.set(network.id, network);
  }

  for (const summary of summaries) {
    const nextValue = values.get(summary.name);
    if (nextValue === undefined) {
      continue;
    }

    for (const occurrence of summary.occurrences) {
      switch (occurrence.kind) {
        case 'service': {
          const service = serviceMap.get(occurrence.serviceSlug);
          updateEnvVarValue(service?.env, occurrence.envKey, nextValue);
          break;
        }
        case 'network': {
          const network = networkMap.get(occurrence.networkId);
          updateEnvVarValue(network?.env, occurrence.envKey, nextValue);
          break;
        }
        case 'network-service': {
          const network = networkMap.get(occurrence.networkId);
          const service = network?.services.find((entry) => entry.serviceSlug === occurrence.serviceSlug);
          updateEnvVarValue(service?.env, occurrence.envKey, nextValue);
          break;
        }
        case 'app-launch': {
          const network = networkMap.get(occurrence.networkId);
          const service = network?.services.find((entry) => entry.app.id === occurrence.appId);
          updateEnvVarValue(service?.app.launchEnv, occurrence.envKey, nextValue);
          break;
        }
        default:
          break;
      }
    }
  }
}

export type ManifestImportHelpers = {
  buildBootstrapContext: typeof buildBootstrapContext;
  updatePlaceholderSummaries: typeof updatePlaceholderSummaries;
  applyPlaceholderValuesToManifest: typeof applyPlaceholderValuesToManifest;
};

export const manifestImportHelpers: ManifestImportHelpers = {
  buildBootstrapContext,
  updatePlaceholderSummaries,
  applyPlaceholderValuesToManifest
};
