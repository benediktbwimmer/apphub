import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useToastHelpers } from '../components/toast';
import {
  createDataset,
  fetchDatasets,
  fetchDatasetAccessAudit
} from './api';
import type {
  CreateDatasetRequest,
  DatasetListResponse,
  DatasetRecord,
  LifecycleJobSummary,
  ManifestPartition,
  ManifestResponse,
  LifecycleMetricsSnapshot,
  DatasetAccessAuditEvent,
  DatasetAccessAuditListResponse
} from './types';
import { DatasetAuditTimeline } from './components/DatasetAuditTimeline';
import { DatasetList } from './components/DatasetList';
import DatasetAdminPanel from './components/DatasetAdminPanel';
import DatasetCreateDialog from './components/DatasetCreateDialog';
import { Spinner } from '../components';
import { RetentionPanel } from './components/RetentionPanel';
import { QueryConsole } from './components/QueryConsole';
import { LifecycleControls } from './components/LifecycleControls';
import { MetricsSummary } from './components/MetricsSummary';
import DatasetHistoryPanel from './components/DatasetHistoryPanel';
import { formatInstant } from './utils';
import { ROUTE_PATHS } from '../routes/paths';
import { useDatasetDetails } from './hooks/useDatasetDetails';
import { useDatasetHistory } from './hooks/useDatasetHistory';

const DATASET_POLL_INTERVAL = 30000;
const AUDIT_POLL_INTERVAL = 60000;
const AUDIT_PAGE_SIZE = 10;

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return '—';
  }
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function summarizeSize(partitions: ManifestResponse['manifest']['partitions']): string {
  const total = partitions.reduce((acc, partition) => acc + (partition.fileSizeBytes ?? 0), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return 'n/a';
  }
  return formatBytes(total);
}

function describePartitionKey(partitionKey: ManifestPartition['partitionKey']): string {
  const entries = Object.entries(partitionKey ?? {});
  if (entries.length === 0) {
    return 'default';
  }
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      if (value === null || value === undefined) {
        return `${key}=—`;
      }
      if (Array.isArray(value)) {
        return `${key}=${value.map((item) => String(item)).join(',')}`;
      }
      if (typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(', ');
}

const STATUS_LABELS: Record<'active' | 'inactive' | 'all', string> = {
  active: 'Active',
  inactive: 'Inactive',
  all: 'All'
};

const EMPTY_DATASETS: DatasetRecord[] = [];

export default function TimestoreDatasetsPage() {
  const { identity } = useAuth();
  const authorizedFetch = useAuthorizedFetch();
  const { showError } = useToastHelpers();
  const scopes = identity?.scopes ?? [];
  const hasAdminScope = scopes.includes('timestore:admin');
  const hasWriteScope = hasAdminScope || scopes.includes('timestore:write');
  const hasReadScope = hasWriteScope || scopes.includes('timestore:read');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [datasetOverrides, setDatasetOverrides] = useState<Record<string, DatasetRecord>>({});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState<DatasetAccessAuditEvent[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditLoadMoreLoading, setAuditLoadMoreLoading] = useState(false);
  const [auditLoadMoreError, setAuditLoadMoreError] = useState<string | null>(null);

  const {
    dataset: datasetResource,
    manifest: manifestResource,
    retention: retentionResource,
    lifecycle: lifecycleResource,
    metrics: metricsResource,
    refreshLifecycle,
    refreshRetention,
    refreshMetrics,
    refreshDataset,
    refreshManifest,
    applyDatasetUpdate
  } = useDatasetDetails(selectedDatasetId);

  const datasetDetail = datasetResource.data;
  const detailLoading = datasetResource.loading;
  const detailError = datasetResource.error;

  const manifest = manifestResource.data;
  const manifestLoading = manifestResource.loading;
  const manifestError = manifestResource.error;

  const retention = retentionResource.data;
  const retentionLoading = retentionResource.loading;
  const retentionError = retentionResource.error;

  const lifecycleData = lifecycleResource.data;
  const lifecycleLoading = lifecycleResource.loading;
  const lifecycleErrorMessage = lifecycleResource.error;

  const metricsText = metricsResource.data;
  const metricsLoading = metricsResource.loading;
  const metricsErrorMessage = metricsResource.error;

  const datasetFetcher = useCallback(
    async ({ authorizedFetch, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      const response = await fetchDatasets(
        authorizedFetch,
        {
          cursor,
          status: statusFilter,
          search: search.trim() ? search.trim() : null,
          limit: 25
        },
        { signal }
      );
      return response;
    },
    [cursor, search, statusFilter]
  );

  const {
    data: datasetsPayload,
    loading: datasetsLoading,
    error: datasetsError,
    refetch: refetchDatasets
  } = usePollingResource<DatasetListResponse>({
    intervalMs: DATASET_POLL_INTERVAL,
    fetcher: datasetFetcher
  });

  const datasets = useMemo(() => {
    const base = datasetsPayload?.datasets ?? EMPTY_DATASETS;
    if (Object.keys(datasetOverrides).length === 0) {
      return base;
    }
    const baseIdSet = new Set(base.map((item) => item.id));
    let mutated = false;
    const merged = base.map((dataset) => {
      const override = datasetOverrides[dataset.id];
      if (override) {
        mutated = true;
        return override;
      }
      return dataset;
    });
    const additions = Object.values(datasetOverrides).filter(
      (record) => record.id === selectedDatasetId && !baseIdSet.has(record.id)
    );
    if (!mutated && additions.length === 0) {
      return base;
    }
    if (additions.length === 0) {
      return merged;
    }
    return [...additions, ...merged];
  }, [datasetsPayload, datasetOverrides, selectedDatasetId]);
  const nextCursor = datasetsPayload?.nextCursor ?? null;

  useEffect(() => {
    if (!datasetsLoading && datasets.length > 0 && !selectedDatasetId) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, datasetsLoading, selectedDatasetId]);

  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [search, statusFilter]);

  useEffect(() => {
    if (!datasetsPayload?.datasets) {
      return;
    }
    setDatasetOverrides((prev) => {
      if (Object.keys(prev).length === 0) {
        return prev;
      }
      const next = { ...prev };
      let updated = false;
      for (const dataset of datasetsPayload.datasets) {
        const override = next[dataset.id];
        if (override && override.updatedAt === dataset.updatedAt) {
          delete next[dataset.id];
          updated = true;
        }
      }
      return updated ? next : prev;
    });
  }, [datasetsPayload]);

  useEffect(() => {
    setAuditEvents([]);
    setAuditNextCursor(null);
    setAuditLoadMoreError(null);
    setAuditLoadMoreLoading(false);
  }, [selectedDatasetId, hasAdminScope]);

  const auditFetcher = useCallback(
    async ({ authorizedFetch, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!selectedDatasetId || !hasAdminScope) {
        return null;
      }
      const response = await fetchDatasetAccessAudit(
        authorizedFetch,
        selectedDatasetId,
        { limit: AUDIT_PAGE_SIZE },
        { signal }
      );
      return response;
    },
    [selectedDatasetId, hasAdminScope]
  );

  const {
    data: auditData,
    loading: auditLoading,
    error: auditError,
    refetch: refetchAudit
  } = usePollingResource<DatasetAccessAuditListResponse | null>({
    intervalMs: AUDIT_POLL_INTERVAL,
    fetcher: auditFetcher,
    enabled: Boolean(selectedDatasetId) && hasAdminScope
  });

  useEffect(() => {
    if (!auditData || !hasAdminScope) {
      return;
    }
    setAuditEvents((prev) => {
      const latestIds = new Set(auditData.events.map((event) => event.id));
      const preserved = prev.filter((event) => !latestIds.has(event.id));
      return [...auditData.events, ...preserved];
    });
    setAuditNextCursor(auditData.nextCursor ?? null);
    setAuditLoadMoreError(null);
  }, [auditData, hasAdminScope]);

  const lifecycleJobs: LifecycleJobSummary[] = lifecycleData?.jobs ?? [];
  const lifecycleMetrics: LifecycleMetricsSnapshot | null = lifecycleData?.metrics ?? null;

  const selectedDatasetRecord = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  const datasetSlugForQuery = datasetDetail?.slug ?? selectedDatasetRecord?.slug ?? null;

  const schemaFields = useMemo(() => manifest?.manifest.schemaVersion?.fields ?? [], [manifest]);
  const defaultTimestampColumn = useMemo(() => {
    const timestampField = schemaFields.find((field) => field.type && field.type.toLowerCase() === 'timestamp');
    return timestampField?.name ?? 'timestamp';
  }, [schemaFields]);

  const {
    events: historyEvents,
    loading: historyLoading,
    loadingMore: historyLoadingMore,
    error: historyError,
    hasMore: historyHasMore,
    lastFetchedAt: historyLastFetchedAt,
    refresh: refreshHistory,
    loadMore: loadMoreHistory
  } = useDatasetHistory({
    datasetId: selectedDatasetId,
    authorizedFetch,
    enabled: hasAdminScope,
    pageSize: 30
  });

  const handleSubmitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

  const handleOpenCreateDialog = () => {
    setCreateDialogOpen(true);
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
  };

  const handleDatasetCreated = useCallback(
    async (request: CreateDatasetRequest) => {
      const response = await createDataset(authorizedFetch, request);
      const created = response.dataset;
      setCursor(null);
      setCursorStack([]);
      setSelectedDatasetId(created.id);
      applyDatasetUpdate(created);
      setDatasetOverrides((prev) => ({ ...prev, [created.id]: created }));
      await refetchDatasets();
      await refreshDataset();
    },
    [applyDatasetUpdate, authorizedFetch, refetchDatasets, refreshDataset]
  );

  const handleDatasetChange = useCallback(
    (updated: DatasetRecord) => {
      setSelectedDatasetId(updated.id);
      applyDatasetUpdate(updated);
      setDatasetOverrides((prev) => ({ ...prev, [updated.id]: updated }));
      void refreshDataset();
    },
    [applyDatasetUpdate, refreshDataset]
  );

  const handleDatasetListRefresh = useCallback(() => {
    void refetchDatasets();
    void refreshDataset();
  }, [refetchDatasets, refreshDataset]);

  const datasetErrorMessage =
    datasetsError instanceof Error
      ? datasetsError.message
      : datasetsError
        ? String(datasetsError)
        : null;
  const auditErrorMessage =
    auditError instanceof Error ? auditError.message : auditError ? String(auditError) : null;

  useEffect(() => {
    if (detailError) {
      showError('Failed to load dataset', detailError);
    }
  }, [detailError, showError]);

  const handleLoadMoreAudit = useCallback(async () => {
    if (!selectedDatasetId || !hasAdminScope || !auditNextCursor || auditLoadMoreLoading) {
      return;
    }
    setAuditLoadMoreLoading(true);
    setAuditLoadMoreError(null);
    try {
      const response = await fetchDatasetAccessAudit(
        authorizedFetch,
        selectedDatasetId,
        { cursor: auditNextCursor, limit: AUDIT_PAGE_SIZE }
      );
      setAuditEvents((prev) => {
        const existingIds = new Set(prev.map((event) => event.id));
        const appended = response.events.filter((event) => !existingIds.has(event.id));
        const combined = [...prev, ...appended];
        combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return combined;
      });
      setAuditNextCursor(response.nextCursor ?? null);
    } catch (err) {
      setAuditLoadMoreError(
        err instanceof Error ? err.message : 'Failed to load additional audit events'
      );
    } finally {
      setAuditLoadMoreLoading(false);
    }
  }, [
    authorizedFetch,
    selectedDatasetId,
    hasAdminScope,
    auditNextCursor,
    auditLoadMoreLoading
  ]);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursorStack((prev) => [...prev, cursor ?? '']);
      setCursor(nextCursor);
    }
  };

  const handlePreviousPage = () => {
    setCursorStack((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const clone = [...prev];
      const last = clone.pop() ?? null;
      setCursor(last && last.length > 0 ? last : null);
      return clone;
    });
  };

  return (
    <>
      <section className="flex flex-col gap-6">
        <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Timestore Datasets</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Browse cataloged datasets, inspect manifests, and review recent lifecycle activity.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={ROUTE_PATHS.servicesTimestoreSql}
                  className="self-start rounded-full border border-violet-500 px-4 py-2 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-400 dark:text-violet-300"
                >
                  Open SQL editor
                </Link>
                {hasAdminScope && (
                  <button
                    type="button"
                    onClick={handleOpenCreateDialog}
                    className="self-start rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  >
                    Create dataset
                  </button>
                )}
              </div>
            </div>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={handleSubmitSearch}>
              <div className="flex items-center gap-2">
                <label htmlFor="timestore-status" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  Status
                </label>
                <select
                  id="timestore-status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                  className="rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 text-sm text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                >
                  {(['active', 'inactive', 'all'] as const).map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="timestore-search" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  Search
                </label>
                <div className="flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 shadow-sm focus-within:border-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80">
                  <input
                    id="timestore-search"
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search by slug or display name"
                    className="w-56 bg-transparent text-sm text-slate-700 outline-none dark:text-slate-100"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,320px),minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <DatasetList
              datasets={datasets}
              selectedId={selectedDatasetId}
              onSelect={setSelectedDatasetId}
              loading={datasetsLoading}
              error={datasetErrorMessage}
              onRetry={refetchDatasets}
            />
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>
                Showing {datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviousPage}
                  disabled={cursorStack.length === 0}
                  className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={!nextCursor}
                  className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {selectedDatasetId ? (
              <>
                <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8 text-sm text-slate-600 dark:text-slate-300">
                      <Spinner label="Loading dataset details" />
                    </div>
                  ) : detailError ? (
                    <div className="text-sm text-rose-600 dark:text-rose-300">{detailError}</div>
                  ) : datasetDetail ? (
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">
                          Dataset
                        </span>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {datasetDetail.displayName ?? datasetDetail.name ?? datasetDetail.slug}
                        </h3>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                          {datasetDetail.slug} • {datasetDetail.status}
                        </p>
                      </div>
                      <dl className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Created</dt>
                          <dd className="text-sm text-slate-800 dark:text-slate-200">{formatInstant(datasetDetail.createdAt)}</dd>
                        </div>
                        <div className="flex flex-col gap-1">
                          <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Updated</dt>
                          <dd className="text-sm text-slate-800 dark:text-slate-200">{formatInstant(datasetDetail.updatedAt)}</dd>
                        </div>
                      </dl>
                      <DatasetAdminPanel
                        dataset={datasetDetail}
                        canEdit={hasAdminScope}
                        onDatasetChange={handleDatasetChange}
                        onRequireListRefresh={handleDatasetListRefresh}
                      />
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600 dark:text-slate-300">Select a dataset to view details.</div>
                  )}
                </div>

                <DatasetAuditTimeline
                  events={auditEvents}
                  loading={auditLoading}
                  error={auditErrorMessage}
                  loadMoreError={auditLoadMoreError}
                  onRetry={() => void refetchAudit()}
                  onLoadMore={() => void handleLoadMoreAudit()}
                  canView={hasAdminScope}
                  loadMoreAvailable={Boolean(auditNextCursor)}
                  loadMoreLoading={auditLoadMoreLoading}
                />

                <RetentionPanel
                  datasetId={selectedDatasetId}
                  retention={retention}
                  loading={retentionLoading}
                  error={retentionError}
                  onRefresh={refreshRetention}
                  canEdit={hasAdminScope}
                />

                <QueryConsole
                  datasetSlug={datasetSlugForQuery}
                  defaultTimestampColumn={defaultTimestampColumn}
                  schemaFields={schemaFields}
                  canQuery={hasReadScope}
                />

                <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
                  <header className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">
                        Manifest
                      </span>
                      <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Latest published manifest</h4>
                    </div>
                    <button
                      type="button"
                      disabled={manifestLoading}
                      onClick={() => {
                        if (selectedDatasetId) {
                          void refreshManifest();
                        }
                      }}
                      className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/70 dark:text-slate-300"
                    >
                      Refresh
                    </button>
                  </header>
                  {manifestLoading ? (
                    <div className="flex items-center justify-center py-8 text-sm text-slate-600 dark:text-slate-300">
                      <Spinner label="Loading manifest" />
                    </div>
                  ) : manifestError ? (
                    <div className="text-sm text-rose-600 dark:text-rose-300">{manifestError}</div>
                  ) : manifest ? (
                    <div className="flex flex-col gap-6">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Version</span>
                          <span className="text-sm text-slate-800 dark:text-slate-200">
                            {manifest.manifest.version}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Partitions</span>
                          <span className="text-sm text-slate-800 dark:text-slate-200">
                            {manifest.manifest.partitions.length}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Published</span>
                          <span className="text-sm text-slate-800 dark:text-slate-200">
                            {formatInstant(manifest.manifest.createdAt)}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Approximate size</span>
                          <span className="text-sm text-slate-800 dark:text-slate-200">
                            {summarizeSize(manifest.manifest.partitions)}
                          </span>
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                        <table className="min-w-full divide-y divide-slate-200/60 text-left text-sm text-slate-600 dark:divide-slate-700/60 dark:text-slate-300">
                          <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.2em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                            <tr>
                              <th className="px-4 py-2">Partition</th>
                              <th className="px-4 py-2">Path</th>
                              <th className="px-4 py-2">Size</th>
                              <th className="px-4 py-2">Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            {manifest.manifest.partitions.slice(0, 5).map((partition) => (
                              <tr key={partition.id} className="border-t border-slate-200/50 dark:border-slate-700/60">
                                <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                                  {describePartitionKey(partition.partitionKey)}
                                </td>
                                <td className="px-4 py-2 text-slate-500 dark:text-slate-300">{partition.filePath}</td>
                                <td className="px-4 py-2 text-slate-500 dark:text-slate-300">{formatBytes(partition.fileSizeBytes)}</td>
                                <td className="px-4 py-2 text-slate-500 dark:text-slate-300">{formatInstant(partition.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {manifest.manifest.partitions.length > 5 && (
                          <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                            Showing first 5 of {manifest.manifest.partitions.length} partitions.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600 dark:text-slate-300">No manifest available.</p>
                  )}
              </div>

              <DatasetHistoryPanel
                events={historyEvents}
                loading={historyLoading}
                loadingMore={historyLoadingMore}
                error={historyError}
                canView={hasAdminScope}
                hasMore={historyHasMore}
                lastFetchedAt={historyLastFetchedAt}
                onRefresh={refreshHistory}
                onLoadMore={loadMoreHistory}
              />

              {datasetSlugForQuery ? (
                <LifecycleControls
                  datasetId={selectedDatasetId}
                  datasetSlug={datasetSlugForQuery}
                  jobs={lifecycleJobs}
                  loading={lifecycleLoading}
                  error={lifecycleErrorMessage}
                  onRefresh={refreshLifecycle}
                  canRun={hasAdminScope}
                  panelId="timestore-lifecycle"
                />
              ) : (
                <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
                  Dataset slug unavailable; lifecycle controls disabled.
                </div>
              )}

              <MetricsSummary
                lifecycleMetrics={lifecycleMetrics}
                metricsText={metricsText}
                loading={metricsLoading}
                error={metricsErrorMessage}
                onRefresh={refreshMetrics}
              />
              </>
            ) : (
              <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
                Select a dataset from the list to view its manifest and lifecycle history.
              </div>
            )}
          </div>
        </div>
      </section>

      <DatasetCreateDialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        onCreate={handleDatasetCreated}
      />
    </>
  );
}
