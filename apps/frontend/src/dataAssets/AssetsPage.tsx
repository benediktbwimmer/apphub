import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetGraphView } from './components/AssetGraphView';
import { AssetDetailsPanel } from './components/AssetDetailsPanel';
import type { AssetGraphData, AssetGraphNode } from './types';
import {
  clearAssetPartitionStale,
  fetchAssetGraph,
  markAssetPartitionStale,
  triggerWorkflowRun,
  saveAssetPartitionParameters,
  deleteAssetPartitionParameters
} from './api';
import type { WorkflowAssetPartitionSummary, WorkflowAssetPartitions } from '../workflows/types';
import { ApiError, fetchWorkflowAssetPartitions, getWorkflowDetail } from '../workflows/api';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useToasts } from '../components/toast';
import { Spinner } from '../components';
import { AssetRecomputeDialog } from './components/AssetRecomputeDialog';

function buildPendingKey(action: string, slug: string, partitionKey: string | null): string {
  return `${action}:${slug}:${partitionKey ?? '::default::'}`;
}

export default function AssetsPage() {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
  const [graph, setGraph] = useState<AssetGraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedWorkflowSlug, setSelectedWorkflowSlug] = useState<string | null>(null);
  const [partitions, setPartitions] = useState<WorkflowAssetPartitions | null>(null);
  const [partitionsLoading, setPartitionsLoading] = useState(false);
  const [partitionsError, setPartitionsError] = useState<string | null>(null);
  const [pendingActionKeys, setPendingActionKeys] = useState<Set<string>>(new Set());
  const [pendingRunPartition, setPendingRunPartition] = useState<WorkflowAssetPartitionSummary | null>(null);
  const [workflowInputsBySlug, setWorkflowInputsBySlug] = useState<Record<
    string,
    { defaultParameters: unknown; parametersSchema: unknown }
  >>({});
  const [workflowInputsLoading, setWorkflowInputsLoading] = useState(false);
  const [workflowInputsError, setWorkflowInputsError] = useState<string | null>(null);

  const refreshGraph = useCallback(async () => {
    const data = await fetchAssetGraph(authorizedFetch);
    setGraph(data);
    return data;
  }, [authorizedFetch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    refreshGraph()
      .catch((err) => {
        if (!active) {
          return;
        }
        const message = err instanceof ApiError ? err.message : 'Failed to load asset graph';
        setError(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshGraph]);

  const selectedAsset: AssetGraphNode | null = useMemo(() => {
    if (!graph || !selectedAssetId) {
      return null;
    }
    return graph.assets.find((asset) => asset.normalizedAssetId === selectedAssetId) ?? null;
  }, [graph, selectedAssetId]);

  useEffect(() => {
    if (!graph || graph.assets.length === 0) {
      setSelectedAssetId(null);
      setSelectedWorkflowSlug(null);
      return;
    }

    if (selectedAssetId) {
      const exists = graph.assets.some((asset) => asset.normalizedAssetId === selectedAssetId);
      if (!exists) {
        const fallback = graph.assets[0];
        setSelectedAssetId(fallback.normalizedAssetId);
        setSelectedWorkflowSlug(fallback.producers[0]?.workflowSlug ?? null);
      }
    } else {
      const first = graph.assets[0];
      setSelectedAssetId(first.normalizedAssetId);
      setSelectedWorkflowSlug(first.producers[0]?.workflowSlug ?? null);
    }
  }, [graph, selectedAssetId]);

  useEffect(() => {
    if (!selectedAsset) {
      setSelectedWorkflowSlug(null);
      return;
    }
    if (!selectedWorkflowSlug) {
      setSelectedWorkflowSlug(selectedAsset.producers[0]?.workflowSlug ?? null);
    }
  }, [selectedAsset, selectedWorkflowSlug]);

  const loadPartitions = useCallback(
    async (assetNode: AssetGraphNode, workflowSlug: string) => {
      setPartitionsLoading(true);
      setPartitionsError(null);
      try {
        const data = await fetchWorkflowAssetPartitions(
          authorizedFetch,
          workflowSlug,
          assetNode.assetId,
          {}
        );
        setPartitions(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed to load partitions';
        setPartitionsError(message);
        setPartitions(null);
      } finally {
        setPartitionsLoading(false);
      }
    },
    [authorizedFetch]
  );

  useEffect(() => {
    if (!selectedAsset || !selectedWorkflowSlug) {
      setPartitions(null);
      setPartitionsError(null);
      return;
    }
    // Only load partitions when there is a producer for the selected workflow.
    const producer = selectedAsset.producers.find((entry) => entry.workflowSlug === selectedWorkflowSlug);
    if (!producer) {
      setPartitions(null);
      setPartitionsError('No producing step available for the selected workflow.');
      return;
    }
    void loadPartitions(selectedAsset, selectedWorkflowSlug);
  }, [selectedAsset, selectedWorkflowSlug, loadPartitions]);

  const handleSelectAsset = useCallback(
    (normalizedAssetId: string) => {
      setSelectedAssetId(normalizedAssetId);
      const assetNode = graph?.assets.find((asset) => asset.normalizedAssetId === normalizedAssetId);
      setSelectedWorkflowSlug(assetNode?.producers[0]?.workflowSlug ?? null);
    },
    [graph]
  );

  const handleSelectWorkflow = useCallback((workflowSlug: string) => {
    setSelectedWorkflowSlug(workflowSlug);
  }, []);

  const withPendingAction = useCallback(
    async (actionKey: string, task: () => Promise<void>) => {
      setPendingActionKeys((prev) => {
        const next = new Set(prev);
        next.add(actionKey);
        return next;
      });
      try {
        await task();
      } finally {
        setPendingActionKeys((prev) => {
          const next = new Set(prev);
          next.delete(actionKey);
          return next;
        });
      }
    },
    []
  );

  const handleRequestRun = useCallback((partition: WorkflowAssetPartitionSummary) => {
    setPendingRunPartition(partition);
  }, []);

  const cachedWorkflowInputs = selectedWorkflowSlug
    ? workflowInputsBySlug[selectedWorkflowSlug]
    : undefined;

  useEffect(() => {
    if (!pendingRunPartition || !selectedWorkflowSlug) {
      setWorkflowInputsError(null);
      return;
    }
    if (cachedWorkflowInputs) {
      setWorkflowInputsError(null);
      return;
    }
    let active = true;
    setWorkflowInputsLoading(true);
    setWorkflowInputsError(null);
    getWorkflowDetail(authorizedFetch, selectedWorkflowSlug)
      .then(({ workflow }) => {
        if (!active) {
          return;
        }
        setWorkflowInputsBySlug((current) => ({
          ...current,
          [selectedWorkflowSlug]: {
            defaultParameters: workflow.defaultParameters ?? {},
            parametersSchema: workflow.parametersSchema ?? null
          }
        }));
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        const message = err instanceof ApiError ? err.message : 'Failed to load workflow defaults';
        setWorkflowInputsError(message);
      })
      .finally(() => {
        if (active) {
          setWorkflowInputsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    authorizedFetch,
    cachedWorkflowInputs,
    pendingRunPartition,
    selectedWorkflowSlug,
    setWorkflowInputsBySlug,
    setWorkflowInputsError,
    setWorkflowInputsLoading
  ]);

  const handleMarkStale = useCallback(
    async (partitionKey: string | null) => {
      if (!selectedAsset || !selectedWorkflowSlug) {
        return;
      }
      const actionKey = buildPendingKey('mark', selectedWorkflowSlug, partitionKey);
      await withPendingAction(actionKey, async () => {
        try {
          await markAssetPartitionStale(authorizedFetch, selectedWorkflowSlug, selectedAsset.assetId, {
            partitionKey
          });
          pushToast({
            tone: 'success',
            title: 'Marked stale',
            description: partitionKey ? `Partition ${partitionKey} marked stale.` : 'Asset marked stale.'
          });
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Failed to mark partition stale';
          pushToast({ tone: 'error', title: 'Mark stale failed', description: message });
        }
      });
    },
    [authorizedFetch, loadPartitions, pushToast, refreshGraph, selectedAsset, selectedWorkflowSlug, withPendingAction]
  );

  const handleClearStale = useCallback(
    async (partitionKey: string | null) => {
      if (!selectedAsset || !selectedWorkflowSlug) {
        return;
      }
      const actionKey = buildPendingKey('clear', selectedWorkflowSlug, partitionKey);
      await withPendingAction(actionKey, async () => {
        try {
          await clearAssetPartitionStale(authorizedFetch, selectedWorkflowSlug, selectedAsset.assetId, partitionKey ?? undefined);
          pushToast({
            tone: 'success',
            title: 'Cleared stale flag',
            description: partitionKey ? `Partition ${partitionKey} marked fresh.` : 'Asset marked fresh.'
          });
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Failed to clear stale flag';
          pushToast({ tone: 'error', title: 'Clear stale failed', description: message });
        }
      });
    },
    [authorizedFetch, loadPartitions, pushToast, refreshGraph, selectedAsset, selectedWorkflowSlug, withPendingAction]
  );

  const handleTriggerRun = useCallback(
    async ({
      partitionKey,
      parameters,
      persistParameters
    }: {
      partitionKey: string | null;
      parameters: unknown;
      persistParameters?: boolean;
    }) => {
      if (!selectedAsset || !selectedWorkflowSlug) {
        throw new Error('Select an asset to trigger a run');
      }
      const actionKey = buildPendingKey('run', selectedWorkflowSlug, partitionKey);
      await withPendingAction(actionKey, async () => {
        try {
          if (persistParameters) {
            await saveAssetPartitionParameters(authorizedFetch, selectedWorkflowSlug, selectedAsset.assetId, {
              partitionKey: partitionKey ?? null,
              parameters
            });
            setPendingRunPartition((current: WorkflowAssetPartitionSummary | null) => {
              if (!current) {
                return current;
              }
              const currentKey = current.partitionKey ?? null;
              if (currentKey !== (partitionKey ?? null)) {
                return current;
              }
              return {
                ...current,
                parameters,
                parametersSource: 'manual',
                parametersCapturedAt: new Date().toISOString(),
                parametersUpdatedAt: new Date().toISOString()
              } satisfies WorkflowAssetPartitionSummary;
            });
          }

          const run = await triggerWorkflowRun(authorizedFetch, selectedWorkflowSlug, {
            partitionKey,
            parameters
          });
          pushToast({
            tone: 'success',
            title: 'Recompute triggered',
            description: `Run ${run.id} enqueued.`
          });
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Failed to trigger recompute';
          pushToast({ tone: 'error', title: 'Recompute failed', description: message });
          throw err;
        }
      });
    },
    [
      authorizedFetch,
      loadPartitions,
      pushToast,
      refreshGraph,
      selectedAsset,
      selectedWorkflowSlug,
      withPendingAction
    ]
  );

  const handleRunDialogSubmit = useCallback(
    async ({
      partitionKey,
      parameters,
      persistParameters
    }: {
      partitionKey: string | null;
      parameters: unknown;
      persistParameters: boolean;
    }) => {
      await handleTriggerRun({ partitionKey, parameters, persistParameters });
    },
    [handleTriggerRun]
  );

  const handleClearStoredParameters = useCallback(
    async (partitionKey: string | null) => {
      if (!selectedAsset || !selectedWorkflowSlug) {
        throw new Error('Select an asset to clear stored parameters');
      }
      const actionKey = buildPendingKey('params', selectedWorkflowSlug, partitionKey);
      await withPendingAction(actionKey, async () => {
        try {
          await deleteAssetPartitionParameters(
            authorizedFetch,
            selectedWorkflowSlug,
            selectedAsset.assetId,
            partitionKey ?? undefined
          );
          pushToast({
            tone: 'success',
            title: 'Stored parameters cleared',
            description: partitionKey ? `Partition ${partitionKey}` : 'Default partition'
          });
          setPendingRunPartition((current: WorkflowAssetPartitionSummary | null) => {
            if (!current) {
              return current;
            }
            const currentKey = current.partitionKey ?? null;
            if (currentKey !== (partitionKey ?? null)) {
              return current;
            }
            return {
              ...current,
              parameters: null,
              parametersSource: null,
              parametersCapturedAt: null,
              parametersUpdatedAt: null
            } satisfies WorkflowAssetPartitionSummary;
          });
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Failed to clear stored parameters';
          pushToast({ tone: 'error', title: 'Clear parameters failed', description: message });
          throw err;
        }
      });
    },
    [
      authorizedFetch,
      loadPartitions,
      pushToast,
      refreshGraph,
      selectedAsset,
      selectedWorkflowSlug,
      withPendingAction
    ]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Assets</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Explore workflow data assets, dependencies, and partition freshness from a unified graph.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-400/60 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-[520px] items-center justify-center rounded-3xl border border-slate-200/70 bg-white/70 text-sm text-slate-500 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-300">
          <Spinner label="Loading asset graph…" />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <AssetGraphView
            data={graph}
            selectedAssetId={selectedAssetId}
            onSelectAsset={handleSelectAsset}
          />
          <AssetDetailsPanel
            asset={selectedAsset ?? null}
            selectedWorkflowSlug={selectedWorkflowSlug}
            onSelectWorkflow={handleSelectWorkflow}
            partitions={partitions}
            partitionsLoading={partitionsLoading}
            partitionsError={partitionsError}
            onMarkStale={handleMarkStale}
            onClearStale={handleClearStale}
            onTriggerRun={handleRequestRun}
            pendingActionKeys={pendingActionKeys}
          />
        </div>
      )}
      <AssetRecomputeDialog
        open={Boolean(pendingRunPartition)}
        workflowSlug={selectedWorkflowSlug}
        assetId={selectedAsset?.assetId ?? null}
        partition={pendingRunPartition}
        workflowDefaultParameters={cachedWorkflowInputs?.defaultParameters}
        workflowParametersSchema={cachedWorkflowInputs?.parametersSchema}
        workflowParametersLoading={Boolean(
          pendingRunPartition && !cachedWorkflowInputs && workflowInputsLoading
        )}
        workflowParametersError={pendingRunPartition ? workflowInputsError : null}
        onClose={() => setPendingRunPartition(null)}
        onSubmit={handleRunDialogSubmit}
        onClearStored={pendingRunPartition ? handleClearStoredParameters : undefined}
      />
    </div>
  );
}
