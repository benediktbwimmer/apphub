import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useWorkflowDefinitions } from './useWorkflowDefinitions';
import {
  fetchWorkflowAssetHistory,
  fetchWorkflowAssetPartitions,
  fetchWorkflowAssets,
  getWorkflowAutoMaterializeOps
} from '../api';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
  WorkflowAutoMaterializeOps
} from '../types';
import { ApiError } from '../api';
import { useAppHubEvent } from '../../events/context';
import { normalizeWorkflowRun } from '../normalizers';

const WORKFLOW_RUN_EVENT_TYPES = [
  'workflow.run.updated',
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled'
] as const;

type WorkflowAssetsContextValue = {
  assetInventory: WorkflowAssetInventoryEntry[];
  assetInventoryLoading: boolean;
  assetInventoryError: string | null;
  selectedAssetId: string | null;
  assetDetail: WorkflowAssetDetail | null;
  assetDetailLoading: boolean;
  assetDetailError: string | null;
  assetPartitions: WorkflowAssetPartitions | null;
  assetPartitionsLoading: boolean;
  assetPartitionsError: string | null;
  autoMaterializeOps: WorkflowAutoMaterializeOps | null;
  autoMaterializeLoading: boolean;
  autoMaterializeError: string | null;
  selectAsset: (assetId: string) => void;
  clearSelectedAsset: () => void;
  refreshAsset: (assetId: string) => void;
  refreshAutoMaterializeOps: (slug: string) => void;
};

const WorkflowAssetsContext = createContext<WorkflowAssetsContextValue | undefined>(undefined);

export function WorkflowAssetsProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch, pushToast } = useWorkflowAccess();
  const { selectedSlug, getWorkflowById } = useWorkflowDefinitions();

  const [assetInventories, setAssetInventories] = useState<Record<string, WorkflowAssetInventoryEntry[]>>({});
  const [assetInventoryLoading, setAssetInventoryLoading] = useState(false);
  const [assetInventoryError, setAssetInventoryError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetDetails, setAssetDetails] = useState<Record<string, WorkflowAssetDetail | null>>({});
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const [assetDetailError, setAssetDetailError] = useState<string | null>(null);
  const [assetPartitionsMap, setAssetPartitionsMap] = useState<Record<string, WorkflowAssetPartitions | null>>({});
  const [assetPartitionsLoading, setAssetPartitionsLoading] = useState(false);
  const [assetPartitionsError, setAssetPartitionsError] = useState<string | null>(null);

  const [autoMaterializeState, setAutoMaterializeState] = useState<
    Record<string, { data: WorkflowAutoMaterializeOps | null; loading: boolean; error: string | null }>
  >({});
  const autoMaterializeStateRef = useRef(autoMaterializeState);

  const assetInventory = useMemo(
    () => (selectedSlug ? assetInventories[selectedSlug] ?? [] : []),
    [assetInventories, selectedSlug]
  );

  const assetDetail = useMemo(() => {
    if (!selectedSlug || !selectedAssetId) {
      return null;
    }
    return assetDetails[`${selectedSlug}:${selectedAssetId}`] ?? null;
  }, [assetDetails, selectedAssetId, selectedSlug]);

  const assetPartitions = useMemo(() => {
    if (!selectedSlug || !selectedAssetId) {
      return null;
    }
    return assetPartitionsMap[`${selectedSlug}:${selectedAssetId}`] ?? null;
  }, [assetPartitionsMap, selectedAssetId, selectedSlug]);

  const loadAssetHistory = useCallback(
    async (assetId: string, options: { limit?: number } = {}) => {
      if (!selectedSlug) {
        return;
      }
      setAssetDetailLoading(true);
      setAssetDetailError(null);
      try {
        const detail = await fetchWorkflowAssetHistory(authorizedFetch, selectedSlug, assetId, options);
        setAssetDetails((previous) => ({
          ...previous,
          [`${selectedSlug}:${assetId}`]: detail
        }));
        setSelectedAssetId(assetId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load asset history';
        setAssetDetailError(message);
        pushToast({
          title: 'Workflow asset history',
          description: message,
          tone: 'error'
        });
      } finally {
        setAssetDetailLoading(false);
      }
    },
    [authorizedFetch, pushToast, selectedSlug]
  );

  const loadAssetPartitions = useCallback(
    async (assetId: string, options: { lookback?: number; force?: boolean } = {}) => {
      if (!selectedSlug) {
        return;
      }
      const cacheKey = `${selectedSlug}:${assetId}`;
      if (!options.force && cacheKey in assetPartitionsMap) {
        return;
      }
      setAssetPartitionsLoading(true);
      setAssetPartitionsError(null);
      try {
        const partitions = await fetchWorkflowAssetPartitions(authorizedFetch, selectedSlug, assetId, {
          lookback: options.lookback
        });
        setAssetPartitionsMap((previous) => ({
          ...previous,
          [cacheKey]: partitions
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load asset partitions';
        setAssetPartitionsError(message);
        pushToast({
          title: 'Workflow asset partitions',
          description: message,
          tone: 'error'
        });
      } finally {
        setAssetPartitionsLoading(false);
      }
    },
    [authorizedFetch, pushToast, selectedSlug, assetPartitionsMap]
  );

  const selectAsset = useCallback(
    (assetId: string) => {
      if (!selectedSlug) {
        return;
      }
      const cacheKey = `${selectedSlug}:${assetId}`;
      setSelectedAssetId(assetId);
      if (!(cacheKey in assetDetails)) {
        void loadAssetHistory(assetId);
      }
      if (!(cacheKey in assetPartitionsMap)) {
        void loadAssetPartitions(assetId);
      }
    },
    [assetDetails, assetPartitionsMap, loadAssetHistory, loadAssetPartitions, selectedSlug]
  );

  const clearSelectedAsset = useCallback(() => {
    setSelectedAssetId(null);
    setAssetDetailError(null);
    setAssetPartitionsError(null);
  }, []);

  const refreshAsset = useCallback(
    (assetId: string) => {
      void loadAssetHistory(assetId);
      void loadAssetPartitions(assetId, { force: true });
    },
    [loadAssetHistory, loadAssetPartitions]
  );

  const loadAutoMaterializeOps = useCallback(
    async (slug: string, options: { force?: boolean } = {}) => {
      if (!slug) {
        return;
      }
      const currentEntry = autoMaterializeStateRef.current[slug];
      if (!options.force && currentEntry?.loading) {
        return;
      }
      if (!options.force && currentEntry && currentEntry.data) {
        return;
      }
      setAutoMaterializeState((current) => ({
        ...current,
        [slug]: {
          data: current[slug]?.data ?? null,
          loading: true,
          error: null
        }
      }));
      try {
        const ops = await getWorkflowAutoMaterializeOps(authorizedFetch, slug, { limit: 20 });
        setAutoMaterializeState((current) => ({
          ...current,
          [slug]: {
            data: ops,
            loading: false,
            error: null
          }
        }));
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to load auto-materialization activity';
        setAutoMaterializeState((current) => ({
          ...current,
          [slug]: {
            data: current[slug]?.data ?? null,
            loading: false,
            error: message
          }
        }));
        pushToast({
          tone: 'error',
          title: 'Auto-materialization activity',
          description: message
        });
      }
    },
    [authorizedFetch, pushToast]
  );

  const refreshAutoMaterializeOps = useCallback(
    (slug: string) => {
      void loadAutoMaterializeOps(slug, { force: true });
    },
    [loadAutoMaterializeOps]
  );

  useEffect(() => {
    autoMaterializeStateRef.current = autoMaterializeState;
  }, [autoMaterializeState]);

  useEffect(() => {
    setSelectedAssetId(null);
    setAssetDetailError(null);
    setAssetDetailLoading(false);
    setAssetPartitionsError(null);
    setAssetPartitionsLoading(false);

    if (!selectedSlug) {
      return;
    }

    let cancelled = false;
    setAssetInventoryLoading(true);
    setAssetInventoryError(null);

    const loadAssets = async () => {
      try {
        const assets = await fetchWorkflowAssets(authorizedFetch, selectedSlug);
        if (cancelled) {
          return;
        }
        setAssetInventories((previous) => ({ ...previous, [selectedSlug]: assets }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof ApiError ? error.message : 'Failed to load workflow assets';
        setAssetInventoryError(message);
        pushToast({
          title: 'Workflow assets',
          description: message,
          tone: 'error'
        });
      } finally {
        if (!cancelled) {
          setAssetInventoryLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, pushToast, selectedSlug]);

  useEffect(() => {
    if (selectedSlug) {
      void loadAutoMaterializeOps(selectedSlug);
    }
  }, [selectedSlug, loadAutoMaterializeOps]);

  useAppHubEvent(WORKFLOW_RUN_EVENT_TYPES, (event) => {
    if (!event.data?.run) {
      return;
    }
    const run = normalizeWorkflowRun(event.data.run);
    if (!run) {
      return;
    }
    const workflow = getWorkflowById(run.workflowDefinitionId);
    if (!workflow) {
      return;
    }
    const trigger = run.trigger;
    if (
      trigger &&
      typeof trigger === 'object' &&
      !Array.isArray(trigger) &&
      (trigger as { type?: unknown }).type === 'auto-materialize'
    ) {
      void loadAutoMaterializeOps(workflow.slug, { force: true });
    }
  });

  const autoMaterializeEntry = selectedSlug ? autoMaterializeState[selectedSlug] : undefined;
  const autoMaterializeOps = autoMaterializeEntry?.data ?? null;
  const autoMaterializeLoading = autoMaterializeEntry?.loading ?? false;
  const autoMaterializeError = autoMaterializeEntry?.error ?? null;

  const value = useMemo<WorkflowAssetsContextValue>(
    () => ({
      assetInventory,
      assetInventoryLoading,
      assetInventoryError,
      selectedAssetId,
      assetDetail,
      assetDetailLoading,
      assetDetailError,
      assetPartitions,
      assetPartitionsLoading,
      assetPartitionsError,
      autoMaterializeOps,
      autoMaterializeLoading,
      autoMaterializeError,
      selectAsset,
      clearSelectedAsset,
      refreshAsset,
      refreshAutoMaterializeOps
    }),
    [
      assetInventory,
      assetInventoryLoading,
      assetInventoryError,
      selectedAssetId,
      assetDetail,
      assetDetailLoading,
      assetDetailError,
      assetPartitions,
      assetPartitionsLoading,
      assetPartitionsError,
      autoMaterializeOps,
      autoMaterializeLoading,
      autoMaterializeError,
      selectAsset,
      clearSelectedAsset,
      refreshAsset,
      refreshAutoMaterializeOps
    ]
  );

  return <WorkflowAssetsContext.Provider value={value}>{children}</WorkflowAssetsContext.Provider>;
}

export function useWorkflowAssets() {
  const context = useContext(WorkflowAssetsContext);
  if (!context) {
    throw new Error('useWorkflowAssets must be used within WorkflowAssetsProvider');
  }
  return context;
}
