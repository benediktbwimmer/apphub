import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useToastHelpers } from '../components/toast';
import { createDataset, fetchDatasets } from './api';
import type {
  CreateDatasetRequest,
  DatasetListResponse,
  DatasetRecord,
  LifecycleJobSummary,
  ManifestPartition,
  LifecycleMetricsSnapshot,
  DatasetSchemaField
} from './types';
import { DatasetList } from './components/DatasetList';
import DatasetAdminPanel from './components/DatasetAdminPanel';
import DatasetCreateDialog from './components/DatasetCreateDialog';
import { CollapsibleSection, Spinner } from '../components';
import { RetentionPanel } from './components/RetentionPanel';
import { QueryConsole } from './components/QueryConsole';
import { LifecycleControls } from './components/LifecycleControls';
import { MetricsSummary } from './components/MetricsSummary';
import DatasetHistoryPanel from './components/DatasetHistoryPanel';
import { formatInstant } from './utils';
import { useDatasetDetails } from './hooks/useDatasetDetails';
import { useDatasetHistory } from './hooks/useDatasetHistory';
import { useStreamingStatus } from './hooks/useStreamingStatus';
import { DatasetStreamingSummary } from './components/DatasetStreamingSummary';
import {
  CARD_SURFACE,
  FIELD_LABEL,
  INPUT,
  PANEL_SHADOW_ELEVATED,
  PANEL_SURFACE_LARGE,
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_COMPACT,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  STATUS_META,
  TABLE_CELL,
  TABLE_CELL_PRIMARY,
  TABLE_CONTAINER,
  TABLE_HEAD_ROW
} from './timestoreTokens';

const DATASET_POLL_INTERVAL = 30000;

const PANEL_ELEVATED = `${PANEL_SURFACE_LARGE} ${PANEL_SHADOW_ELEVATED}`;

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

function summarizeSize(partitions: ManifestPartition[]): string {
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

  const {
    status: streamingStatus,
    history: streamingHistory,
    loading: streamingLoading,
    error: streamingError,
    refresh: refreshStreaming
  } = useStreamingStatus();

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

  const manifestEntries = useMemo(() => manifest?.manifests ?? [], [manifest]);
  const manifestPartitions = useMemo(
    () =>
      manifestEntries.flatMap((entry) =>
        entry.partitions.map((partition) => ({
          partition,
          manifestShard: entry.manifestShard ?? partition.manifestShard ?? null,
          manifestVersion: entry.version,
          publishedAt: entry.publishedAt ?? entry.updatedAt ?? entry.createdAt
        }))
      ),
    [manifestEntries]
  );

  const manifestPartitionPreview = useMemo(() => {
    if (manifestPartitions.length === 0) {
      return [] as typeof manifestPartitions;
    }
    return [...manifestPartitions]
      .sort((a, b) => {
        const left = Date.parse(a.partition.createdAt);
        const right = Date.parse(b.partition.createdAt);
        if (Number.isNaN(left) && Number.isNaN(right)) {
          return 0;
        }
        if (Number.isNaN(left)) {
          return 1;
        }
        if (Number.isNaN(right)) {
          return -1;
        }
        return right - left;
      })
      .slice(0, 5);
  }, [manifestPartitions]);
  const totalManifestPartitions = manifestPartitions.length;
  const manifestApproximateSize = useMemo(
    () => summarizeSize(manifestPartitions.map((item) => item.partition)),
    [manifestPartitions]
  );

  const latestManifestEntry = useMemo(() => {
    if (manifestEntries.length === 0) {
      return null;
    }
    return manifestEntries.reduce((latest, current) => {
      const currentTimestamp = Date.parse(current.publishedAt ?? current.updatedAt ?? current.createdAt);
      const latestTimestamp = Date.parse(latest.publishedAt ?? latest.updatedAt ?? latest.createdAt);
      if (Number.isNaN(currentTimestamp)) {
        return latest;
      }
      if (Number.isNaN(latestTimestamp) || currentTimestamp > latestTimestamp) {
        return current;
      }
      return latest;
    }, manifestEntries[0]);
  }, [manifestEntries]);

  const latestManifestTimestamp = latestManifestEntry
    ? latestManifestEntry.publishedAt ?? latestManifestEntry.updatedAt ?? latestManifestEntry.createdAt
    : null;
  const latestManifestVersion = latestManifestEntry?.version ?? null;
  const manifestShardCount = manifestEntries.length;

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

  const lifecycleJobs: LifecycleJobSummary[] = lifecycleData?.jobs ?? [];
  const lifecycleMetrics: LifecycleMetricsSnapshot | null = lifecycleData?.metrics ?? null;

  const selectedDatasetRecord = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  const activeDatasetForAdmin = datasetDetail ?? selectedDatasetRecord;

  const datasetSlugForQuery = datasetDetail?.slug ?? selectedDatasetRecord?.slug ?? null;

  const streamingSummary = useMemo(() => {
    if (!streamingStatus || !streamingStatus.enabled) {
      return null;
    }
    const bufferedRows = streamingStatus.batchers.connectors.reduce((total, connector) => total + connector.bufferedRows, 0);
    const openWindows = streamingStatus.batchers.connectors.reduce((total, connector) => total + connector.openWindows, 0);
    return {
      state: streamingStatus.state,
      bufferedRows,
      openWindows,
      datasets: streamingStatus.hotBuffer.datasets,
      sparklineRows: streamingHistory.map((sample) => sample.bufferedRows)
    } as const;
  }, [streamingHistory, streamingStatus]);

  const schemaFields = useMemo<DatasetSchemaField[]>(() => {
    const [latestManifest] = manifestEntries;
    return latestManifest?.schemaVersion?.fields ?? [];
  }, [manifestEntries]);
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

  const handleSubmitSearch = (event: FormEvent<HTMLFormElement>) => {
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
  useEffect(() => {
    if (detailError) {
      showError('Failed to load dataset', detailError);
    }
  }, [detailError, showError]);

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
        <header className={PANEL_ELEVATED}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-2">
              <h2 className="text-scale-lg font-weight-semibold text-primary">Timestore Datasets</h2>
              <p className={STATUS_MESSAGE}>
                Browse cataloged datasets, inspect manifests, and review recent lifecycle activity.
              </p>
              {hasAdminScope ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleOpenCreateDialog} className={`${PRIMARY_BUTTON} self-start`}>
                    Create dataset
                  </button>
                </div>
              ) : null}
            </div>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={handleSubmitSearch}>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="timestore-status" className={FIELD_LABEL}>
                  Status
                </label>
                <select
                  id="timestore-status"
                  value={statusFilter}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setStatusFilter(event.target.value as typeof statusFilter)
                  }
                  className={`${INPUT} w-36`}
                >
                  {(['active', 'inactive', 'all'] as const).map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="timestore-search" className={FIELD_LABEL}>
                  Search
                </label>
                <input
                  id="timestore-search"
                  type="search"
                  value={searchInput}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchInput(event.target.value)}
                  placeholder="Search by slug or display name"
                  className={`${INPUT} w-56`}
                />
                {searchInput && (
                  <button type="button" onClick={handleClearSearch} className={SECONDARY_BUTTON_COMPACT}>
                    Clear
                  </button>
                )}
                <button type="submit" className={PRIMARY_BUTTON_COMPACT}>
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
            <div className={`flex items-center justify-between ${STATUS_META}`}>
              <span>
                Showing {datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviousPage}
                  disabled={cursorStack.length === 0}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={!nextCursor}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {selectedDatasetId ? (
              <>
                <div className={PANEL_ELEVATED}>
                  {detailLoading ? (
                    <div className={`flex items-center justify-center py-8 ${STATUS_MESSAGE}`}>
                      <Spinner label="Loading dataset details" />
                    </div>
                  ) : detailError ? (
                    <div className={STATUS_BANNER_DANGER}>{detailError}</div>
                  ) : datasetDetail ? (
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-1">
                        <span className={FIELD_LABEL}>
                          Dataset
                        </span>
                        <h3 className="text-scale-lg font-weight-semibold text-primary">
                          {datasetDetail.displayName ?? datasetDetail.name ?? datasetDetail.slug}
                        </h3>
                        <p className={STATUS_META}>
                          {datasetDetail.slug} • {datasetDetail.status}
                        </p>
                      </div>
                      <dl className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <dt className={FIELD_LABEL}>Created</dt>
                          <dd className={`${STATUS_MESSAGE} text-primary`}>{formatInstant(datasetDetail.createdAt)}</dd>
                        </div>
                        <div className="flex flex-col gap-1">
                          <dt className={FIELD_LABEL}>Updated</dt>
                          <dd className={`${STATUS_MESSAGE} text-primary`}>{formatInstant(datasetDetail.updatedAt)}</dd>
                        </div>
                      </dl>
                      <p className={STATUS_META}>
                        Use the advanced controls below to update metadata, retention, and lifecycle settings.
                      </p>
                    </div>
                  ) : (
                    <div className={STATUS_MESSAGE}>Select a dataset to view details.</div>
                  )}
                </div>

                <DatasetStreamingSummary
                  datasetSlug={datasetSlugForQuery}
                  streamingStatus={streamingStatus}
                  history={streamingHistory}
                  loading={streamingLoading}
                  error={streamingError}
                  onRefresh={refreshStreaming}
                />

                <CollapsibleSection
                  title="Advanced dataset controls"
                  description="Configure metadata, retention, lifecycle automation, and metrics."
                >
                  <div className="flex flex-col gap-6">
                    {activeDatasetForAdmin ? (
                      <DatasetAdminPanel
                        dataset={activeDatasetForAdmin}
                        canEdit={hasAdminScope}
                        onDatasetChange={handleDatasetChange}
                        onRequireListRefresh={handleDatasetListRefresh}
                      />
                    ) : (
                      <div className={CARD_SURFACE}>
                        <p className={STATUS_MESSAGE}>Dataset metadata is still loading.</p>
                      </div>
                    )}
                    <RetentionPanel
                      datasetId={selectedDatasetId}
                      retention={retention}
                      loading={retentionLoading}
                      error={retentionError}
                      onRefresh={refreshRetention}
                      canEdit={hasAdminScope}
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
                      <div className={CARD_SURFACE}>
                        <p className={STATUS_MESSAGE}>Dataset slug unavailable; lifecycle controls disabled.</p>
                      </div>
                    )}
                    <MetricsSummary
                      lifecycleMetrics={lifecycleMetrics}
                      metricsText={metricsText}
                      loading={metricsLoading}
                      error={metricsErrorMessage}
                      onRefresh={refreshMetrics}
                      streamingSummary={streamingSummary}
                    />
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Query dataset"
                  description="Run time-window queries without leaving the datasets view."
                >
                  {hasReadScope ? (
                    <QueryConsole
                      datasetSlug={datasetSlugForQuery}
                      defaultTimestampColumn={defaultTimestampColumn}
                      schemaFields={schemaFields}
                      canQuery={hasReadScope}
                    />
                  ) : (
                    <div className={CARD_SURFACE}>
                      <p className={STATUS_MESSAGE}>timestore:read scope is required to run queries.</p>
                    </div>
                  )}
                </CollapsibleSection>

                <div className={PANEL_ELEVATED}>
                  <header className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className={FIELD_LABEL}>Manifest</span>
                      <h4 className="text-scale-base font-weight-semibold text-primary">Latest published manifest</h4>
                    </div>
                    <button
                      type="button"
                      disabled={manifestLoading}
                      onClick={() => {
                        if (selectedDatasetId) {
                          void refreshManifest();
                        }
                      }}
                      className={SECONDARY_BUTTON_COMPACT}
                    >
                      Refresh
                    </button>
                  </header>
                  {manifestLoading ? (
                    <div className={`flex items-center justify-center py-8 ${STATUS_MESSAGE}`}>
                      <Spinner label="Loading manifest" />
                    </div>
                  ) : manifestError ? (
                    <div className={STATUS_BANNER_DANGER}>{manifestError}</div>
                  ) : manifestShardCount > 0 ? (
                    <div className="flex flex-col gap-6">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="flex flex-col gap-1">
                          <span className={FIELD_LABEL}>Version</span>
                          <span className={`${STATUS_MESSAGE} text-primary`}>
                            {latestManifestVersion ?? 'n/a'}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={FIELD_LABEL}>Partitions</span>
                          <span className={`${STATUS_MESSAGE} text-primary`}>
                            {totalManifestPartitions}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={FIELD_LABEL}>Published</span>
                          <span className={`${STATUS_MESSAGE} text-primary`}>
                            {latestManifestTimestamp ? formatInstant(latestManifestTimestamp) : 'n/a'}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={FIELD_LABEL}>Approximate size</span>
                          <span className={`${STATUS_MESSAGE} text-primary`}>
                            {manifestApproximateSize}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={FIELD_LABEL}>Shards</span>
                          <span className={`${STATUS_MESSAGE} text-primary`}>
                            {manifestShardCount}
                          </span>
                        </div>
                      </div>
                      <div className={`${TABLE_CONTAINER} max-h-[320px] overflow-auto`}>
                        <table className="min-w-full text-left">
                          <thead className={TABLE_HEAD_ROW}>
                            <tr>
                              <th className={TABLE_CELL_PRIMARY}>Partition</th>
                              <th className={TABLE_CELL_PRIMARY}>Shard</th>
                              <th className={TABLE_CELL_PRIMARY}>Path</th>
                              <th className={TABLE_CELL_PRIMARY}>Size</th>
                              <th className={TABLE_CELL_PRIMARY}>Created</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-subtle">
                            {manifestPartitionPreview.length === 0 ? (
                              <tr>
                                <td className={`${TABLE_CELL} text-center`} colSpan={5}>
                                  No partitions have been published for this dataset yet.
                                </td>
                              </tr>
                            ) : (
                              manifestPartitionPreview.map(({ partition, manifestShard }) => (
                                <tr key={partition.id}>
                                  <td className={TABLE_CELL}>
                                    {describePartitionKey(partition.partitionKey)}
                                  </td>
                                  <td className={TABLE_CELL}>{manifestShard ?? 'default'}</td>
                                  <td className={TABLE_CELL}>{partition.filePath}</td>
                                  <td className={TABLE_CELL}>{formatBytes(partition.fileSizeBytes)}</td>
                                  <td className={TABLE_CELL}>{formatInstant(partition.createdAt)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                        {manifestPartitionPreview.length > 0 &&
                          totalManifestPartitions > manifestPartitionPreview.length && (
                          <div className={`px-4 py-2 ${STATUS_META}`}>
                            Showing first {manifestPartitionPreview.length} of {totalManifestPartitions} partitions.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className={STATUS_MESSAGE}>No manifest available.</p>
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

              </>
            ) : (
              <div className={CARD_SURFACE}>
                <p className={STATUS_MESSAGE}>
                  Select a dataset from the list to view its manifest and lifecycle history.
                </p>
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
