import type { JobDefinitionRecord } from '../db/types';

export type JobRuntimeKind = 'node' | 'python' | 'docker' | 'module';

export function resolveJobRuntime(definition: JobDefinitionRecord): JobRuntimeKind {
  if (definition.runtime === 'python') {
    return 'python';
  }
  if (definition.runtime === 'node') {
    return 'node';
  }
  if (definition.runtime === 'docker') {
    return 'docker';
  }
  if (definition.runtime === 'module') {
    return 'module';
  }
  const metadata = definition.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    const rawRuntime = record.runtime;
    if (typeof rawRuntime === 'string') {
      const normalized = rawRuntime.trim().toLowerCase();
      if (normalized.startsWith('python')) {
        return 'python';
      }
      if (normalized.startsWith('docker')) {
        return 'docker';
      }
      if (normalized.startsWith('node')) {
        return 'node';
      }
      if (normalized.startsWith('module')) {
        return 'module';
      }
    } else if (rawRuntime && typeof rawRuntime === 'object' && !Array.isArray(rawRuntime)) {
      const runtimeRecord = rawRuntime as Record<string, unknown>;
      const type = runtimeRecord.type;
      if (typeof type === 'string') {
        const normalized = type.trim().toLowerCase();
        if (normalized.startsWith('python')) {
          return 'python';
        }
        if (normalized.startsWith('docker')) {
          return 'docker';
        }
        if (normalized.startsWith('node')) {
          return 'node';
        }
        if (normalized.startsWith('module')) {
          return 'module';
        }
      }
    }
  }

  return 'node';
}
