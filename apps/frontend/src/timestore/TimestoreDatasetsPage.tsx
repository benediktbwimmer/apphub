import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useToastHelpers } from '../components/toast';
import {
  fetchDatasets,
  fetchDatasetById,
  fetchDatasetManifest,
  fetchLifecycleStatus,
  fetchRetentionPolicy,
  fetchMetrics
} from './api';
import type {
  DatasetListResponse,
  DatasetRecord,
  LifecycleJobSummary,
  LifecycleStatusResponse,
  ManifestResponse,
  RetentionResponse,
  LifecycleMetricsSnapshot
} from './types';
import { DatasetList } from './components/DatasetList';
import { Spinner } from '../components';
import { RetentionPanel } from './components/RetentionPanel';
import { QueryConsole } from './components/QueryConsole';
import { LifecycleControls } from './components/LifecycleControls';
import { MetricsSummary } from './components/MetricsSummary';
import { formatInstant } from './utils';
import { ROUTE_PATHS } from '../routes/paths';

const DATASET_POLL_INTERVAL = 30000;
const LIFECYCLE_POLL_INTERVAL = 60000;

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
  const total = partitions.reduce((acc, partition) => acc + (partition.sizeBytes ?? 0), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return 'n/a';
  }
  return formatBytes(total);
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
  const [datasetDetail, setDatasetDetail] = useState<DatasetRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [retention, setRetention] = useState<RetentionResponse | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionVersion, setRetentionVersion] = useState(0);
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsVersion, setMetricsVersion] = useState(0);

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

  const datasets = datasetsPayload?.datasets ?? EMPTY_DATASETS;
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
    if (!selectedDatasetId) {
      setDatasetDetail(null);
      setDetailError(null);
      setManifest(null);
      setManifestError(null);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);

    fetchDatasetById(authorizedFetch, selectedDatasetId, { signal: controller.signal })
      .then((record) => {
        setDatasetDetail(record);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        showError('Failed to load dataset', err);
        setDetailError(err instanceof Error ? err.message : 'Failed to load dataset');
        setDatasetDetail(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authorizedFetch, selectedDatasetId, showError]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setManifest(null);
      setManifestError(null);
      return;
    }
    const controller = new AbortController();
    setManifestLoading(true);
    setManifestError(null);

    fetchDatasetManifest(authorizedFetch, selectedDatasetId, { signal: controller.signal })
      .then((response) => {
        setManifest(response);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setManifest(null);
        setManifestError(err instanceof Error ? err.message : 'Failed to load manifest');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setManifestLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authorizedFetch, selectedDatasetId]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setRetention(null);
      setRetentionError(null);
      setRetentionLoading(false);
      return;
    }
    const controller = new AbortController();
    setRetentionLoading(true);
    setRetentionError(null);
    fetchRetentionPolicy(authorizedFetch, selectedDatasetId, { signal: controller.signal })
      .then((response) => {
        setRetention(response);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setRetentionError(err instanceof Error ? err.message : 'Failed to load retention policy');
        setRetention(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRetentionLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authorizedFetch, selectedDatasetId, retentionVersion]);

  useEffect(() => {
    const controller = new AbortController();
    setMetricsLoading(true);
    setMetricsError(null);
    fetchMetrics(authorizedFetch, { signal: controller.signal })
      .then((text) => {
        setMetricsText(text);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setMetricsError(err instanceof Error ? err.message : 'Failed to load metrics');
        setMetricsText(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setMetricsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authorizedFetch, metricsVersion, selectedDatasetId]);

  const lifecycleFetcher = useCallback(
    async ({ authorizedFetch, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!selectedDatasetId) {
        return null;
      }
      const response = await fetchLifecycleStatus(
        authorizedFetch,
        { limit: 10, datasetId: selectedDatasetId },
        { signal }
      );
      return response;
    },
    [selectedDatasetId]
  );

  const {
    data: lifecycleData,
    loading: lifecycleLoading,
    error: lifecycleError,
    refetch: refetchLifecycle
  } = usePollingResource<LifecycleStatusResponse | null>({
    intervalMs: LIFECYCLE_POLL_INTERVAL,
    fetcher: lifecycleFetcher,
    enabled: Boolean(selectedDatasetId)
  });

  const lifecycleJobs: LifecycleJobSummary[] = lifecycleData?.jobs ?? [];
  const lifecycleMetrics: LifecycleMetricsSnapshot | null = lifecycleData?.metrics ?? null;

  const refreshRetention = useCallback(() => {
    setRetentionVersion((prev) => prev + 1);
  }, []);

  const refreshMetrics = useCallback(() => {
    setMetricsVersion((prev) => prev + 1);
  }, []);

  const selectedDatasetRecord = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  const datasetSlugForQuery = datasetDetail?.slug ?? selectedDatasetRecord?.slug ?? null;

  const handleSubmitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

  const datasetErrorMessage = datasetsError instanceof Error ? datasetsError.message : datasetsError ? String(datasetsError) : null;
  const lifecycleErrorMessage = lifecycleError instanceof Error ? lifecycleError.message : lifecycleError ? String(lifecycleError) : null;
  const metricsErrorMessage = metricsError;

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
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Timestore Datasets</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Browse cataloged datasets, inspect manifests, and review recent lifecycle activity.
            </p>
            <Link
              to={ROUTE_PATHS.servicesTimestoreSql}
              className="self-start rounded-full border border-violet-500 px-4 py-2 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-400 dark:text-violet-300"
            >
              Open SQL editor
            </Link>
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
                  <div className="flex flex-col gap-4">
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
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Storage Target</dt>
                        <dd className="text-sm text-slate-800 dark:text-slate-200">
                          {datasetDetail.defaultStorageTargetId ?? 'default'}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">IAM Scopes</dt>
                        <dd className="text-sm text-slate-800 dark:text-slate-200">
                          {datasetDetail.metadata?.iam?.readScopes?.length
                            ? `Read: ${datasetDetail.metadata?.iam?.readScopes?.join(', ')}`
                            : 'Read: inherits global'}
                          <br />
                          {datasetDetail.metadata?.iam?.writeScopes?.length
                            ? `Write: ${datasetDetail.metadata?.iam?.writeScopes?.join(', ')}`
                            : 'Write: inherits global'}
                        </dd>
                      </div>
                    </dl>
                    {datasetDetail.description && (
                      <p className="text-sm text-slate-700 dark:text-slate-300">{datasetDetail.description}</p>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">Select a dataset to view details.</div>
                )}
              </div>

              <RetentionPanel
                datasetId={selectedDatasetId}
                retention={retention}
                loading={retentionLoading}
                error={retentionError}
                onRefresh={refreshRetention}
                canEdit={hasAdminScope}
              />

              <QueryConsole datasetSlug={datasetSlugForQuery} defaultTimestampColumn="timestamp" canQuery={hasReadScope} />

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
                    onClick={() => {
                      if (selectedDatasetId) {
                        setManifestLoading(true);
                        fetchDatasetManifest(authorizedFetch, selectedDatasetId)
                          .then((response) => {
                            setManifest(response);
                          })
                          .catch((err) => {
                            showError('Failed to refresh manifest', err);
                          })
                          .finally(() => {
                            setManifestLoading(false);
                          });
                      }
                    }}
                    className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
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
                  <div className="mt-4 flex flex-col gap-4">
                    <dl className="grid gap-4 sm:grid-cols-3">
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Version</dt>
                        <dd className="text-sm text-slate-800 dark:text-slate-200">{manifest.manifest.version}</dd>
                      </div>
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Published</dt>
                        <dd className="text-sm text-slate-800 dark:text-slate-200">{formatInstant(manifest.manifest.createdAt)}</dd>
                      </div>
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Partitions</dt>
                        <dd className="text-sm text-slate-800 dark:text-slate-200">{manifest.manifest.partitions.length}</dd>
                      </div>
                      <div className="flex flex-col gap-1">
                        <dt className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Approximate size</dt>
                        <dd className="text-sm text-slate-800 dark:text-slate-200">{summarizeSize(manifest.manifest.partitions)}</dd>
                      </div>
                    </dl>
                    {manifest.manifest.partitions.length > 0 ? (
                      <div className="overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.2em] text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
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
                                  {partition.partitionKey ?? 'default'}
                                </td>
                                <td className="px-4 py-2 text-slate-500 dark:text-slate-300">{partition.storagePath}</td>
                                <td className="px-4 py-2 text-slate-500 dark:text-slate-300">{formatBytes(partition.sizeBytes)}</td>
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
                    ) : (
                      <p className="text-sm text-slate-600 dark:text-slate-300">No partitions published yet.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-300">No manifest available.</p>
                )}
              </div>

              {datasetSlugForQuery ? (
                <LifecycleControls
                  datasetId={selectedDatasetId}
                  datasetSlug={datasetSlugForQuery}
                  jobs={lifecycleJobs}
                  loading={lifecycleLoading}
                  error={lifecycleErrorMessage}
                  onRefresh={refetchLifecycle}
                  canRun={hasAdminScope}
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
  );
}
