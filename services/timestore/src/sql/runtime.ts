interface PendingInvalidation {
  datasetId: string | null;
  datasetSlug: string | null;
  scope: 'all' | 'dataset';
  reason: string | null;
  requestedAt: string;
}

export interface SqlRuntimeInvalidationOptions {
  scope?: 'all' | 'dataset';
  datasetId?: string;
  datasetSlug?: string;
  reason?: string;
}

interface RuntimeCacheState {
  pendingInvalidations: PendingInvalidation[];
  lastUpdatedAt: string | null;
}

const state: RuntimeCacheState = {
  pendingInvalidations: [],
  lastUpdatedAt: null
};

export function invalidateSqlRuntimeCache(options: SqlRuntimeInvalidationOptions = {}): void {
  const scope = options.scope ?? (options.datasetId || options.datasetSlug ? 'dataset' : 'all');
  const entry: PendingInvalidation = {
    datasetId: scope === 'dataset' ? options.datasetId ?? null : null,
    datasetSlug: scope === 'dataset' ? options.datasetSlug ?? null : null,
    scope,
    reason: options.reason ?? null,
    requestedAt: new Date().toISOString()
  };

  if (scope === 'all') {
    state.pendingInvalidations = [entry];
  } else {
    const existingIndex = state.pendingInvalidations.findIndex((candidate) => {
      return candidate.datasetId === entry.datasetId && candidate.datasetSlug === entry.datasetSlug;
    });
    if (existingIndex >= 0) {
      state.pendingInvalidations[existingIndex] = entry;
    } else {
      state.pendingInvalidations.push(entry);
    }
  }

  state.lastUpdatedAt = entry.requestedAt;
}

export function getSqlRuntimeCacheSnapshot() {
  return {
    pendingInvalidations: [...state.pendingInvalidations],
    datasets: state.pendingInvalidations.filter((entry) => entry.scope === 'dataset').length,
    entries: state.pendingInvalidations.length,
    stale: state.pendingInvalidations.length,
    sizeBytes: 0,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

export function resetSqlRuntimeCache(): void {
  state.pendingInvalidations = [];
  state.lastUpdatedAt = null;
}
