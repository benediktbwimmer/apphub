import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useDocumentVisibility } from '../../hooks/useDocumentVisibility';
import { usePollingResource } from '../../hooks/usePollingResource';
import {
  fetchDatasetById,
  fetchDatasetManifest,
  fetchLifecycleStatus,
  fetchMetrics,
  fetchRetentionPolicy
} from '../api';
import type {
  DatasetRecord,
  LifecycleStatusResponse,
  ManifestResponse,
  RetentionResponse
} from '../types';

const DETAIL_POLL_INTERVAL_VISIBLE = 30_000;
const DETAIL_POLL_INTERVAL_HIDDEN = 120_000;

const ALL_TARGETS = ['dataset', 'manifest', 'retention', 'lifecycle', 'metrics'] as const;

type ResourceKey = (typeof ALL_TARGETS)[number];

type FetchBehavior = {
  forceLoading: boolean;
  dropDataOnError: boolean;
};

const DEFAULT_BEHAVIOR: FetchBehavior = { forceLoading: false, dropDataOnError: true };
const MANUAL_BEHAVIOR: FetchBehavior = { forceLoading: true, dropDataOnError: true };

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastUpdatedAt: number | null;
}

interface DatasetDetailState {
  dataset: ResourceState<DatasetRecord>;
  manifest: ResourceState<ManifestResponse>;
  retention: ResourceState<RetentionResponse>;
  lifecycle: ResourceState<LifecycleStatusResponse | null>;
  metrics: ResourceState<string>;
}

function createResourceState<T>(): ResourceState<T> {
  return {
    data: null,
    error: null,
    loading: false,
    lastUpdatedAt: null
  };
}

function createInitialState(): DatasetDetailState {
  return {
    dataset: createResourceState<DatasetRecord>(),
    manifest: createResourceState<ManifestResponse>(),
    retention: createResourceState<RetentionResponse>(),
    lifecycle: createResourceState<LifecycleStatusResponse | null>(),
    metrics: createResourceState<string>()
  };
}

function isAbortError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  const name = (error as { name?: string }).name;
  return name === 'AbortError';
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

function applyLoadingState<T>(current: ResourceState<T>, behavior: FetchBehavior): ResourceState<T> | null {
  const shouldShowLoading = behavior.forceLoading || current.data === null;
  if (!shouldShowLoading && !behavior.forceLoading) {
    return null;
  }
  if (current.loading === shouldShowLoading && (!behavior.forceLoading || current.error === null)) {
    return null;
  }
  return {
    ...current,
    loading: shouldShowLoading,
    error: behavior.forceLoading ? null : current.error
  };
}

function applyResultState<T>(
  current: ResourceState<T>,
  result: PromiseSettledResult<unknown>,
  behavior: FetchBehavior,
  mapValue: (value: unknown) => T,
  fallback: string
): ResourceState<T> | null {
  if (result.status === 'fulfilled') {
    const value = mapValue(result.value);
    return {
      data: value,
      error: null,
      loading: false,
      lastUpdatedAt: Date.now()
    };
  }
  if (isAbortError(result.reason)) {
    if (!current.loading) {
      return null;
    }
    return {
      ...current,
      loading: false
    };
  }
  const message = toErrorMessage(result.reason, fallback);
  return {
    data: behavior.dropDataOnError ? null : current.data,
    error: message,
    loading: false,
    lastUpdatedAt: current.lastUpdatedAt
  };
}

export interface UseDatasetDetailsResult {
  dataset: ResourceState<DatasetRecord>;
  manifest: ResourceState<ManifestResponse>;
  retention: ResourceState<RetentionResponse>;
  lifecycle: ResourceState<LifecycleStatusResponse | null>;
  metrics: ResourceState<string>;
  refreshAll: () => Promise<void>;
  refreshLifecycle: () => Promise<void>;
  refreshRetention: () => Promise<void>;
  refreshMetrics: () => Promise<void>;
  refreshDataset: () => Promise<void>;
  refreshManifest: () => Promise<void>;
  applyDatasetUpdate: (record: DatasetRecord) => void;
}

export function useDatasetDetails(datasetId: string | null): UseDatasetDetailsResult {
  const authorizedFetch = useAuthorizedFetch();
  const isVisible = useDocumentVisibility();
  const [state, setState] = useState<DatasetDetailState>(() => createInitialState());
  const datasetIdRef = useRef<string | null>(datasetId);
  const fetchTargetsRef = useRef<ResourceKey[]>(Array.from(ALL_TARGETS));
  const behaviorRef = useRef<FetchBehavior>(DEFAULT_BEHAVIOR);
  const fetchCountRef = useRef(0);

  useEffect(() => {
    datasetIdRef.current = datasetId;
  }, [datasetId]);

  useEffect(() => {
    setState(createInitialState());
    fetchTargetsRef.current = Array.from(ALL_TARGETS);
    behaviorRef.current = DEFAULT_BEHAVIOR;
    fetchCountRef.current = 0;
  }, [datasetId]);

  const prepareResources = useCallback((targets: readonly ResourceKey[], behavior: FetchBehavior) => {
    if (targets.length === 0) {
      return;
    }
    setState((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const key of targets) {
        switch (key) {
          case 'dataset': {
            const updated = applyLoadingState(prev.dataset, behavior);
            if (updated && updated !== prev.dataset) {
              next.dataset = updated;
              changed = true;
            }
            break;
          }
          case 'manifest': {
            const updated = applyLoadingState(prev.manifest, behavior);
            if (updated && updated !== prev.manifest) {
              next.manifest = updated;
              changed = true;
            }
            break;
          }
          case 'retention': {
            const updated = applyLoadingState(prev.retention, behavior);
            if (updated && updated !== prev.retention) {
              next.retention = updated;
              changed = true;
            }
            break;
          }
          case 'lifecycle': {
            const updated = applyLoadingState(prev.lifecycle, behavior);
            if (updated && updated !== prev.lifecycle) {
              next.lifecycle = updated;
              changed = true;
            }
            break;
          }
          case 'metrics': {
            const updated = applyLoadingState(prev.metrics, behavior);
            if (updated && updated !== prev.metrics) {
              next.metrics = updated;
              changed = true;
            }
            break;
          }
        }
      }

      return changed ? next : prev;
    });
  }, []);

  const performFetch = useCallback(
    async (targets: readonly ResourceKey[], behavior: FetchBehavior, signal?: AbortSignal) => {
      if (!datasetId) {
        return;
      }

      const snapshotId = datasetId;
      prepareResources(targets, behavior);

      const operations = targets.map((key) => {
        switch (key) {
          case 'dataset':
            return fetchDatasetById(authorizedFetch, snapshotId, { signal });
          case 'manifest':
            return fetchDatasetManifest(authorizedFetch, snapshotId, { signal });
          case 'retention':
            return fetchRetentionPolicy(authorizedFetch, snapshotId, { signal });
          case 'lifecycle':
            return fetchLifecycleStatus(authorizedFetch, { datasetId: snapshotId, limit: 10 }, { signal });
          case 'metrics':
            return fetchMetrics(authorizedFetch, { signal });
          default:
            return Promise.resolve(null);
        }
      });

      const results = await Promise.allSettled(operations);

      setState((prev) => {
        if (snapshotId !== datasetIdRef.current) {
          return prev;
        }

        let changed = false;
        const next = { ...prev };

        results.forEach((result, index) => {
          const key = targets[index];
          switch (key) {
            case 'dataset': {
              const updated = applyResultState(prev.dataset, result, behavior, (value) => value as DatasetRecord, 'Failed to load dataset');
              if (updated && updated !== prev.dataset) {
                next.dataset = updated;
                changed = true;
              }
              break;
            }
            case 'manifest': {
              const updated = applyResultState(prev.manifest, result, behavior, (value) => value as ManifestResponse, 'Failed to load manifest');
              if (updated && updated !== prev.manifest) {
                next.manifest = updated;
                changed = true;
              }
              break;
            }
            case 'retention': {
              const updated = applyResultState(prev.retention, result, behavior, (value) => value as RetentionResponse, 'Failed to load retention policy');
              if (updated && updated !== prev.retention) {
                next.retention = updated;
                changed = true;
              }
              break;
            }
            case 'lifecycle': {
              const updated = applyResultState(prev.lifecycle, result, behavior, (value) => value as LifecycleStatusResponse | null, 'Failed to load lifecycle status');
              if (updated && updated !== prev.lifecycle) {
                next.lifecycle = updated;
                changed = true;
              }
              break;
            }
            case 'metrics': {
              const updated = applyResultState(prev.metrics, result, behavior, (value) => value as string, 'Failed to load metrics');
              if (updated && updated !== prev.metrics) {
                next.metrics = updated;
                changed = true;
              }
              break;
            }
          }
        });

        return changed ? next : prev;
      });
    },
    [authorizedFetch, datasetId, prepareResources]
  );

  const pollFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!datasetId) {
        return { datasetId: null, completedAt: Date.now(), targets: [] };
      }

      const targets = fetchTargetsRef.current.length > 0 ? [...fetchTargetsRef.current] : Array.from(ALL_TARGETS);
      const behavior = behaviorRef.current;
      fetchTargetsRef.current = Array.from(ALL_TARGETS);
      behaviorRef.current = DEFAULT_BEHAVIOR;

      await performFetch(targets, behavior, signal);

      if (import.meta.env.DEV) {
        fetchCountRef.current += 1;
        // eslint-disable-next-line no-console
        console.debug(
          `[timestore] detail poll #${fetchCountRef.current} dataset=${datasetId} targets=${targets.join(',')}`
        );
      }

      return { datasetId, completedAt: Date.now(), targets };
    },
    [datasetId, performFetch]
  );

  const pollInterval = useMemo(
    () => (isVisible ? DETAIL_POLL_INTERVAL_VISIBLE : DETAIL_POLL_INTERVAL_HIDDEN),
    [isVisible]
  );

  const { refetch: triggerFetch } = usePollingResource({
    fetcher: pollFetcher,
    intervalMs: pollInterval,
    enabled: Boolean(datasetId),
    immediate: true
  });

  const scheduleFetch = useCallback(
    async (targets: readonly ResourceKey[]) => {
      if (!datasetId) {
        return;
      }
      fetchTargetsRef.current = targets.length > 0 ? [...targets] : Array.from(ALL_TARGETS);
      behaviorRef.current = MANUAL_BEHAVIOR;
      await triggerFetch();
    },
    [datasetId, triggerFetch]
  );

  const refreshAll = useCallback(async () => {
    await scheduleFetch(ALL_TARGETS);
  }, [scheduleFetch]);

  const refreshLifecycle = useCallback(async () => {
    await scheduleFetch(['lifecycle']);
  }, [scheduleFetch]);

  const refreshRetention = useCallback(async () => {
    await scheduleFetch(['retention']);
  }, [scheduleFetch]);

  const refreshMetrics = useCallback(async () => {
    await scheduleFetch(['metrics']);
  }, [scheduleFetch]);

  const refreshDataset = useCallback(async () => {
    await scheduleFetch(['dataset']);
  }, [scheduleFetch]);

  const refreshManifest = useCallback(async () => {
    await scheduleFetch(['manifest']);
  }, [scheduleFetch]);

  const applyDatasetUpdate = useCallback((record: DatasetRecord) => {
    if (datasetIdRef.current !== record.id) {
      return;
    }
    setState((prev) => {
      const nextDataset: ResourceState<DatasetRecord> = {
        data: record,
        error: null,
        loading: false,
        lastUpdatedAt: Date.now()
      };
      const current = prev.dataset;
      if (
        current.data &&
        current.data.id === record.id &&
        current.data.updatedAt === record.updatedAt &&
        current.error === null &&
        current.loading === false
      ) {
        return prev;
      }
      return {
        ...prev,
        dataset: nextDataset
      };
    });
  }, []);

  return {
    dataset: state.dataset,
    manifest: state.manifest,
    retention: state.retention,
    lifecycle: state.lifecycle,
    metrics: state.metrics,
    refreshAll,
    refreshLifecycle,
    refreshRetention,
    refreshMetrics,
    refreshDataset,
    refreshManifest,
    applyDatasetUpdate
  };
}
