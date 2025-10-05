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
import { fetchWorkflowAssetPartitions, getWorkflowDetail } from '../workflows/api';
import { ApiError } from '../lib/apiClient';
import { useAuth } from '../auth/useAuth';
import { useToastHelpers } from '../components/toast';
import { Spinner } from '../components';
import { AssetRecomputeDialog } from './components/AssetRecomputeDialog';
import {
  DATA_ASSET_ALERT_ERROR,
  DATA_ASSET_EMPTY_STATE,
  DATA_ASSET_PAGE_SUBTITLE,
  DATA_ASSET_PAGE_TITLE
} from './dataAssetsTokens';

function buildPendingKey(action: string, slug: string, partitionKey: string | null): string {
  return `${action}:${slug}:${partitionKey ?? '::default::'}`;
}

export default function AssetsPage() {
  const { activeToken: authToken } = useAuth();
  const { showSuccess, showError, showDestructiveSuccess, showDestructiveError } = useToastHelpers();
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
    if (!authToken) {
      throw new ApiError('Authentication required', 401);
    }
    const data = await fetchAssetGraph(authToken);
    setGraph(data);
    return data;
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
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
  }, [authToken, refreshGraph]);

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
      if (!authToken) {
        throw new ApiError('Authentication required', 401);
      }
      setPartitionsLoading(true);
      setPartitionsError(null);
      try {
        const data = await fetchWorkflowAssetPartitions(
          authToken,
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
    [authToken]
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
    if (!authToken || !pendingRunPartition || !selectedWorkflowSlug) {
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
    getWorkflowDetail(authToken, selectedWorkflowSlug)
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
    authToken,
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
          await markAssetPartitionStale(authToken, selectedWorkflowSlug, selectedAsset.assetId, {
            partitionKey
          });
          showDestructiveSuccess('Mark stale', partitionKey ? `partition ${partitionKey}` : 'asset');
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          showDestructiveError('Mark stale', err instanceof ApiError ? err : 'Failed to mark partition stale');
        }
      });
    },
    [
      authToken,
      loadPartitions,
      refreshGraph,
      selectedAsset,
      selectedWorkflowSlug,
      showDestructiveError,
      showDestructiveSuccess,
      withPendingAction
    ]
  );

  const handleClearStale = useCallback(
    async (partitionKey: string | null) => {
      if (!selectedAsset || !selectedWorkflowSlug) {
        return;
      }
      const actionKey = buildPendingKey('clear', selectedWorkflowSlug, partitionKey);
      await withPendingAction(actionKey, async () => {
        try {
          await clearAssetPartitionStale(authToken, selectedWorkflowSlug, selectedAsset.assetId, partitionKey ?? undefined);
          showDestructiveSuccess('Clear stale flag', partitionKey ? `partition ${partitionKey}` : 'asset');
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          showDestructiveError('Clear stale flag', err instanceof ApiError ? err : 'Failed to clear stale flag');
        }
      });
    },
    [
      authToken,
      loadPartitions,
      refreshGraph,
      selectedAsset,
      selectedWorkflowSlug,
      showDestructiveError,
      showDestructiveSuccess,
      withPendingAction
    ]
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
            await saveAssetPartitionParameters(authToken, selectedWorkflowSlug, selectedAsset.assetId, {
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

          const run = await triggerWorkflowRun(authToken, selectedWorkflowSlug, {
            partitionKey,
            parameters
          });
          showSuccess('Recompute triggered', `Run ${run.id} enqueued.`);
          await loadPartitions(selectedAsset, selectedWorkflowSlug);
          await refreshGraph();
        } catch (err) {
          showError('Recompute failed', err, 'Failed to trigger recompute');
          throw err;
        }
      });
    },
    [
      authToken,
      loadPartitions,
      refreshGraph,
      selectedAsset,
      selectedWorkflowSlug,
      showError,
      showSuccess,
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
            authToken,
            selectedWorkflowSlug,
            selectedAsset.assetId,
            partitionKey ?? undefined
          );
          showDestructiveSuccess('Clear stored parameters', partitionKey ? `partition ${partitionKey}` : 'default partition');
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
          showDestructiveError('Clear stored parameters', err instanceof ApiError ? err : 'Failed to clear stored parameters');
          throw err;
        }
      });
    },
    [
      authToken,
      loadPartitions,
      refreshGraph,
      selectedAsset,
      selectedWorkflowSlug,
      showDestructiveError,
      showDestructiveSuccess,
      withPendingAction
    ]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={DATA_ASSET_PAGE_TITLE}>Assets</h1>
        <p className={DATA_ASSET_PAGE_SUBTITLE}>
          Explore workflow data assets, dependencies, and partition freshness from a unified graph.
        </p>
      </div>

      {error && <div className={DATA_ASSET_ALERT_ERROR}>{error}</div>}

      {loading ? (
        <div className={DATA_ASSET_EMPTY_STATE}>
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
