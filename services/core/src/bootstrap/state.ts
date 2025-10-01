import type { JsonValue } from '../serviceManifestTypes';
import { cloneJsonValue, ensureJsonObject } from './template';

const workflowDefaultsByModule = new Map<string, Map<string, Record<string, JsonValue>>>();

export function registerWorkflowDefaults(
  moduleId: string,
  defaults: Map<string, Record<string, JsonValue>>
): void {
  if (defaults.size === 0) {
    workflowDefaultsByModule.delete(moduleId);
    return;
  }

  const normalized = new Map<string, Record<string, JsonValue>>();
  for (const [slug, value] of defaults) {
    // ensure deep clone so callers cannot mutate stored state
    const objectValue = ensureJsonObject(cloneJsonValue(value), `workflow defaults for ${slug}`);
    normalized.set(slug, objectValue);
  }

  workflowDefaultsByModule.set(moduleId, normalized);
}

export function getWorkflowDefaultParameters(slug: string): Record<string, JsonValue> | null {
  const merged: Record<string, JsonValue> = {};
  let found = false;
  for (const moduleDefaults of workflowDefaultsByModule.values()) {
    const defaults = moduleDefaults.get(slug);
    if (!defaults) {
      continue;
    }
    for (const [key, value] of Object.entries(defaults)) {
      merged[key] = cloneJsonValue(value);
    }
    found = true;
  }
  return found ? merged : null;
}

export function resetWorkflowDefaults(): void {
  workflowDefaultsByModule.clear();
}

export function getRegisteredWorkflowDefaultModules(): string[] {
  return Array.from(workflowDefaultsByModule.keys());
}
