import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthIdentity } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useToastHelpers } from '../components/toast';
import {
  enqueueReconciliation,
  fetchNodeById,
  fetchNodeChildren,
  listBackendMounts,
  listNodes,
  presignNodeDownload,
  updateNodeMetadata,
  subscribeToFilestoreEvents,
  type FetchNodeChildrenParams,
  type FilestoreBackendMount,
  type FilestoreEventType,
  type FilestoreNode,
  type FilestoreNodeChildren,
  type FilestoreNodeKind,
  type FilestoreNodeList,
  type FilestoreNodeState,
  type FilestorePagination,
  type FilestoreReconciliationReason,
  type ListNodesParams
} from './api';
import { FILESTORE_BASE_URL } from '../config';
import { formatBytes } from '../catalog/utils';
import { describeFilestoreEvent, type ActivityEntry } from './eventSummaries';
import { useAnalytics } from '../utils/useAnalytics';
import { triggerWorkflowRun } from '../dataAssets/api';
import { listWorkflowDefinitions } from '../workflows/api';
import type { WorkflowDefinition } from '../workflows/types';
import {
  FILESTORE_DRIFT_PLAYBOOKS,
  getPlaybookForState,
  playbooksRequireWorkflows,
  type PlaybookWorkflowAction
} from './playbooks';

const LIST_PAGE_SIZE = 25;
const ACTIVITY_LIMIT = 50;
const STATE_OPTIONS: FilestoreNodeState[] = ['active', 'inconsistent', 'missing', 'deleted', 'unknown'];
const KIND_LABEL: Record<FilestoreNodeKind, string> = {
  directory: 'Directory',
  file: 'File',
  unknown: 'Node'
};
const STATE_LABEL: Record<FilestoreNodeState, string> = {
  active: 'Active',
  inconsistent: 'Inconsistent',
  missing: 'Missing',
  deleted: 'Deleted',
  unknown: 'Unknown'
};
const STATE_BADGE_CLASS: Record<FilestoreNodeState, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  inconsistent: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  missing: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
  deleted: 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
  unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200'
};
const CONSISTENCY_LABEL: Record<string, string> = {
  active: 'Consistent',
  inconsistent: 'Drift',
  missing: 'Missing'
};
const SSE_EVENT_TYPES: FilestoreEventType[] = [
  'filestore.node.created',
  'filestore.node.updated',
  'filestore.node.deleted',
  'filestore.node.uploaded',
  'filestore.node.moved',
  'filestore.node.copied',
  'filestore.command.completed',
  'filestore.drift.detected',
  'filestore.node.reconciled',
  'filestore.node.missing',
  'filestore.node.downloaded'
];
const MOUNT_STORAGE_KEY = 'apphub.filestore.selectedMountId';
const SHOULD_LOAD_PLAYBOOK_WORKFLOWS = playbooksRequireWorkflows(FILESTORE_DRIFT_PLAYBOOKS);
type RefreshTimers = {
  list: number | null;
  node: number | null;
  children: number | null;
};

type DownloadStatus = {
  state: 'pending' | 'error';
  mode: 'stream' | 'presign';
  progress?: number;
  error?: string;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function buildListParams(input: {
  backendMountId: number;
  offset: number;
  limit: number;
  path: string | null;
  depth: number;
  search: string | null;
  states: FilestoreNodeState[];
  driftOnly: boolean;
}): ListNodesParams {
  return {
    backendMountId: input.backendMountId,
    offset: input.offset,
    limit: input.limit,
    path: input.path,
    depth: input.path ? input.depth : null,
    search: input.search,
    states: input.states,
    driftOnly: input.driftOnly
  };
}

function buildChildrenParams(input: { limit: number }): FetchNodeChildrenParams {
  return { limit: input.limit };
}

type FilestoreExplorerPageProps = {
  identity: AuthIdentity | null;
};

export default function FilestoreExplorerPage({ identity }: FilestoreExplorerPageProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showError, showSuccess, showInfo } = useToastHelpers();
  const { trackEvent } = useAnalytics();

  const authDisabled = identity?.authDisabled ?? false;
  const hasWriteScope =
    authDisabled || (identity?.scopes ? identity.scopes.includes('filestore:write') || identity.scopes.includes('filestore:admin') : false);

  const [backendMountId, setBackendMountId] = useState<number | null>(null);
  const [mountsLoading, setMountsLoading] = useState(true);
  const [mountsError, setMountsError] = useState<string | null>(null);
  const [availableMounts, setAvailableMounts] = useState<FilestoreBackendMount[]>([]);
  const [extraMountIds, setExtraMountIds] = useState<number[]>([]);
  const [pathDraft, setPathDraft] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [depth, setDepth] = useState<number>(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [stateFilters, setStateFilters] = useState<FilestoreNodeState[]>([]);
  const [driftOnly, setDriftOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [downloadStatusByNode, setDownloadStatusByNode] = useState<Record<number, DownloadStatus>>({});

  const refreshTimers = useRef<RefreshTimers>({ list: null, node: null, children: null });

  const registerMountId = useCallback(
    (value: number | null | undefined) => {
      if (!value || !Number.isFinite(value) || value <= 0) {
        return;
      }
      setExtraMountIds((prev) => {
        if (prev.includes(value) || availableMounts.some((mount) => mount.id === value)) {
          return prev;
        }
        return [...prev, value].sort((a, b) => a - b);
      });
    },
    [availableMounts]
  );

  const listFetcher = useCallback(
    async ({ authorizedFetch: fetchFn, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (backendMountId === null) {
        throw new Error('Backend mount not selected');
      }
      const mountId = backendMountId;
      const params = buildListParams({
        backendMountId: mountId,
        offset,
        limit: LIST_PAGE_SIZE,
        path: activePath,
        depth,
        search: searchTerm,
        states: stateFilters,
        driftOnly
      });
      return listNodes(fetchFn, params, { signal });
    },
    [backendMountId, offset, activePath, depth, searchTerm, stateFilters, driftOnly]
  );

  const {
    data: listData,
    error: listError,
    loading: listLoading,
    refetch: refetchList
  } = usePollingResource<FilestoreNodeList>({
    fetcher: listFetcher,
    intervalMs: 20000,
    enabled: backendMountId !== null
  });

  const detailFetcher = useCallback(
    async ({ authorizedFetch: fetchFn, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!selectedNodeId) {
        throw new Error('Node not selected');
      }
      return fetchNodeById(fetchFn, selectedNodeId, { signal });
    },
    [selectedNodeId]
  );

  const {
    data: selectedNode,
    error: nodeError,
    loading: nodeLoading,
    refetch: refetchNode
  } = usePollingResource<FilestoreNode>({
    fetcher: detailFetcher,
    intervalMs: 15000,
    enabled: selectedNodeId !== null
  });

  const childrenFetcher = useCallback(
    async ({ authorizedFetch: fetchFn, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!selectedNodeId) {
        throw new Error('Node not selected');
      }
      const params = buildChildrenParams({ limit: 50 });
      return fetchNodeChildren(fetchFn, selectedNodeId, params, { signal });
    },
    [selectedNodeId]
  );

  const {
    data: childrenData,
    loading: childrenLoading,
    error: childrenError,
    refetch: refetchChildren
  } = usePollingResource<FilestoreNodeChildren>({
    fetcher: childrenFetcher,
    intervalMs: 20000,
    enabled: selectedNodeId !== null
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadMounts = async () => {
      setMountsLoading(true);
      setMountsError(null);
      try {
        const result = await listBackendMounts(authorizedFetch, { signal: controller.signal });
        if (cancelled) {
          return;
        }
        setAvailableMounts(result.mounts);
        setExtraMountIds((prev) => prev.filter((id) => !result.mounts.some((mount) => mount.id === id)));

        let nextId: number | null = null;
        let storedId: number | null = null;
        if (typeof window !== 'undefined') {
          const stored = window.localStorage.getItem(MOUNT_STORAGE_KEY);
          if (stored) {
            const parsed = Number.parseInt(stored, 10);
            storedId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
          }
        }

        if (storedId && result.mounts.some((mount) => mount.id === storedId)) {
          nextId = storedId;
        } else if (result.mounts.length > 0) {
          nextId = result.mounts[0].id;
        } else {
          nextId = null;
        }

        setBackendMountId(nextId);

        if (typeof window !== 'undefined') {
          if (nextId) {
            window.localStorage.setItem(MOUNT_STORAGE_KEY, String(nextId));
          } else {
            window.localStorage.removeItem(MOUNT_STORAGE_KEY);
          }
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Unable to load backend mounts';
        setMountsError(message);
        setAvailableMounts([]);
        setExtraMountIds([]);
        setBackendMountId(null);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(MOUNT_STORAGE_KEY);
        }
        showError('Failed to load filestore mounts', err);
      } finally {
        if (!cancelled) {
          setMountsLoading(false);
        }
      }
    };

    void loadMounts();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authorizedFetch, showError]);

  useEffect(() => {
    if (!listData || backendMountId === null) {
      return;
    }
    registerMountId(listData.filters.backendMountId ?? backendMountId);
    if (!listData.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(listData.nodes[0]?.id ?? null);
    }
  }, [listData, backendMountId, registerMountId, selectedNodeId]);

  useEffect(() => {
    registerMountId(backendMountId);
  }, [backendMountId, registerMountId]);

  useEffect(() => {
    if (selectedNode) {
      setMetadataDraft(JSON.stringify(selectedNode.metadata ?? {}, null, 2));
    } else {
      setMetadataDraft('');
    }
    setMetadataEditing(false);
    setMetadataPending(false);
    setMetadataErrorMessage(null);
  }, [selectedNode]);

  useEffect(() => {
    const timers = refreshTimers.current;
    return () => {
      for (const key of Object.keys(timers) as Array<keyof RefreshTimers>) {
        const timer = timers[key];
        if (timer) {
          clearTimeout(timer);
          timers[key] = null;
        }
      }
    };
  }, []);

  const scheduleRefresh = useCallback((key: keyof RefreshTimers, action: () => void) => {
    const timers = refreshTimers.current;
    if (timers[key]) {
      clearTimeout(timers[key]!);
    }
    timers[key] = window.setTimeout(() => {
      timers[key] = null;
      action();
    }, 250);
  }, []);

  const startDownload = useCallback((nodeId: number, mode: DownloadStatus['mode']) => {
    setDownloadStatusByNode((prev) => ({
      ...prev,
      [nodeId]: {
        state: 'pending',
        mode,
        progress: mode === 'stream' ? 0 : undefined
      }
    }));
  }, []);

  const updateDownloadProgress = useCallback((nodeId: number, progress: number) => {
    setDownloadStatusByNode((prev) => {
      const existing = prev[nodeId];
      if (!existing || existing.mode !== 'stream') {
        return prev;
      }
      return {
        ...prev,
        [nodeId]: {
          ...existing,
          progress
        }
      };
    });
  }, []);

  const failDownload = useCallback((nodeId: number, mode: DownloadStatus['mode'], message: string) => {
    setDownloadStatusByNode((prev) => ({
      ...prev,
      [nodeId]: {
        state: 'error',
        mode,
        error: message
      }
    }));
  }, []);

  const finishDownload = useCallback((nodeId: number) => {
    setDownloadStatusByNode((prev) => {
      if (!(nodeId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  useEffect(() => {
    const subscription = subscribeToFilestoreEvents(
      authorizedFetch,
      async (event) => {
        const entry = describeFilestoreEvent(event);
        setActivity((prev) => {
          const next = [entry, ...prev.filter((existing) => existing.id !== entry.id)];
          if (next.length > ACTIVITY_LIMIT) {
            next.length = ACTIVITY_LIMIT;
          }
          return next;
        });

        if (entry.backendMountId) {
          registerMountId(entry.backendMountId);
        }

        if (entry.backendMountId === backendMountId) {
          scheduleRefresh('list', refetchList);
          const eventNodeId = 'nodeId' in event.data ? event.data.nodeId : null;
          const eventPath = 'path' in event.data ? event.data.path : null;
          const matchesSelectedById = selectedNodeId && eventNodeId === selectedNodeId;
          const matchesSelectedByPath = selectedNode?.path && eventPath === selectedNode.path;
          if (matchesSelectedById || matchesSelectedByPath) {
            scheduleRefresh('node', refetchNode);
            scheduleRefresh('children', refetchChildren);
          }
        }
      },
      {
        eventTypes: SSE_EVENT_TYPES,
        onError: (error) => {
          showInfo(error.message ?? 'Filestore event stream closed, retrying shortly.');
        }
      }
    );

    return () => {
      subscription.close();
    };
  }, [
    authorizedFetch,
    backendMountId,
    refetchChildren,
    refetchList,
    refetchNode,
    registerMountId,
    scheduleRefresh,
    selectedNode?.path,
    selectedNodeId,
    showInfo
  ]);

  const stateFilterSet = useMemo(() => new Set(stateFilters), [stateFilters]);

  const handleToggleState = useCallback(
    (state: FilestoreNodeState) => {
      setStateFilters((prev) => {
        if (prev.includes(state)) {
          return prev.filter((value) => value !== state);
        }
        return [...prev, state];
      });
      setOffset(0);
    },
    []
  );

  const handleApplyPath = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setActivePath(trimmed.length > 0 ? trimmed : null);
      setOffset(0);
    },
    []
  );

  const handleApplySearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setSearchTerm(trimmed.length > 0 ? trimmed : null);
      setOffset(0);
    },
    []
  );

  const mountOptions = useMemo(() => {
    const base = availableMounts.map((mount) => {
      const kindLabel = mount.backendKind === 'local' ? 'Local' : 'S3';
      const stateSuffix = mount.state && mount.state !== 'active' ? ` · ${mount.state}` : '';
      return {
        id: mount.id,
        label: `${mount.mountKey} · ${kindLabel}${stateSuffix}`
      };
    });
    const extras = extraMountIds
      .filter((id) => !availableMounts.some((mount) => mount.id === id))
      .map((id) => ({
        id,
        label: `Mount ${id}`
      }));
    return [...base, ...extras].sort((a, b) => a.id - b.id);
  }, [availableMounts, extraMountIds]);

  const hasMountOptions = mountOptions.length > 0;

  const applyBackendMountSelection = useCallback(
    (value: number | null, source: 'input' | 'select') => {
      setBackendMountId(value);
      if (backendMountId === value) {
        return;
      }
      setOffset(0);
      setSelectedNodeId(null);
      if (typeof window !== 'undefined') {
        if (value !== null) {
          window.localStorage.setItem(MOUNT_STORAGE_KEY, String(value));
        } else {
          window.localStorage.removeItem(MOUNT_STORAGE_KEY);
        }
      }
      if (value !== null) {
        registerMountId(value);
        trackEvent('filestore.mount.changed', {
          backendMountId: value,
          source
        });
      } else {
        trackEvent('filestore.mount.cleared', { source });
      }
    },
    [backendMountId, registerMountId, trackEvent]
  );

  const pagination: FilestorePagination | null = listData?.pagination ?? null;
  const nodes = listData?.nodes ?? [];
  const selectedDownloadState = selectedNode ? downloadStatusByNode[selectedNode.id] : undefined;

  const playbook = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    return getPlaybookForState(selectedNode.state);
  }, [selectedNode]);

  const playbookContext = selectedNode ? { node: selectedNode } : null;

  const fallbackPlaybookMessage = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    switch (selectedNode.state) {
      case 'active':
        return 'Node is consistent—no remediation required.';
      case 'deleted':
        return 'Node is deleted. Use restore workflows if content should return.';
      default:
        return 'No automated playbook configured for this state yet.';
    }
  }, [selectedNode]);

  const [reconcileReason, setReconcileReason] = useState<FilestoreReconciliationReason>('manual');
  const [reconcileDetectChildren, setReconcileDetectChildren] = useState(false);
  const [reconcileRequestHash, setReconcileRequestHash] = useState(false);
  const [pendingReconcileActionId, setPendingReconcileActionId] = useState<string | null>(null);
  const [pendingWorkflowActionId, setPendingWorkflowActionId] = useState<string | null>(null);
  const [workflowDefinitions, setWorkflowDefinitions] = useState<Record<string, WorkflowDefinition>>({});
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [metadataEditing, setMetadataEditing] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState('');
  const [metadataPending, setMetadataPending] = useState(false);
  const [metadataErrorMessage, setMetadataErrorMessage] = useState<string | null>(null);

  const enqueueReconcile = useCallback(
    async (
      node: FilestoreNode | null,
      options: {
        reason?: FilestoreReconciliationReason;
        detectChildren?: boolean;
        requestHash?: boolean;
        actionId?: string;
        source?: string;
        playbookId?: string | null;
      } = {}
    ) => {
      if (!node) {
        return;
      }

      const reasonValue = options.reason ?? reconcileReason;
      const detectChildrenValue = options.detectChildren ?? reconcileDetectChildren;
      const requestHashValue = options.requestHash ?? reconcileRequestHash;
      const actionId = options.actionId ?? 'manual-controls';
      const source = options.source ?? 'manual-controls';
      const playbookId = options.playbookId ?? null;

      setPendingReconcileActionId(actionId);
      try {
        await enqueueReconciliation(authorizedFetch, {
          backendMountId: node.backendMountId,
          path: node.path,
          nodeId: node.id,
          reason: reasonValue,
          detectChildren: detectChildrenValue,
          requestedHash: requestHashValue
        });
        showSuccess('Reconciliation job enqueued');
        trackEvent('filestore.reconciliation.enqueued', {
          source,
          actionId,
          playbookId,
          nodeId: node.id,
          backendMountId: node.backendMountId,
          state: node.state,
          reason: reasonValue,
          detectChildren: detectChildrenValue,
          requestHash: requestHashValue
        });
        scheduleRefresh('node', refetchNode);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enqueue reconciliation job';
        showError('Failed to enqueue reconciliation job', err);
        trackEvent('filestore.reconciliation.failed', {
          source,
          actionId,
          playbookId,
          nodeId: node.id,
          backendMountId: node.backendMountId,
          state: node.state,
          reason: reasonValue,
          detectChildren: detectChildrenValue,
          requestHash: requestHashValue,
          error: message
        });
      } finally {
        setPendingReconcileActionId(null);
      }
    },
    [
      authorizedFetch,
      reconcileDetectChildren,
      reconcileReason,
      reconcileRequestHash,
      refetchNode,
      scheduleRefresh,
      showError,
      showSuccess,
      trackEvent
    ]
  );

  useEffect(() => {
    if (!SHOULD_LOAD_PLAYBOOK_WORKFLOWS) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      setWorkflowsLoading(true);
      setWorkflowsError(null);
      try {
        const definitions = await listWorkflowDefinitions(authorizedFetch);
        if (cancelled) {
          return;
        }
        const map: Record<string, WorkflowDefinition> = {};
        for (const definition of definitions) {
          map[definition.slug] = definition;
        }
        setWorkflowDefinitions(map);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load workflows';
        setWorkflowsError(message);
        setWorkflowDefinitions({});
      } finally {
        if (!cancelled) {
          setWorkflowsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authorizedFetch]);

  const runPlaybookWorkflow = useCallback(
    async (action: PlaybookWorkflowAction, playbookId: string, node: FilestoreNode) => {
      setPendingWorkflowActionId(action.id);
      try {
        const parameters = action.buildParameters ? action.buildParameters({ node }) : undefined;
        const run = await triggerWorkflowRun(authorizedFetch, action.workflowSlug, {
          triggeredBy: action.triggeredBy ?? 'filestore-playbook',
          parameters
        });
        showSuccess('Workflow run triggered', `Run ${run.id} enqueued.`);
        trackEvent('filestore.playbook.workflow_triggered', {
          playbookId,
          actionId: action.id,
          workflowSlug: action.workflowSlug,
          nodeId: node.id,
          backendMountId: node.backendMountId,
          state: node.state,
          runId: run.id
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to trigger workflow run';
        showError('Failed to trigger workflow run', err);
        trackEvent('filestore.playbook.workflow_failed', {
          playbookId,
          actionId: action.id,
          workflowSlug: action.workflowSlug,
          nodeId: node.id,
          backendMountId: node.backendMountId,
          state: node.state,
          error: message
        });
      } finally {
        setPendingWorkflowActionId(null);
      }
    },
    [authorizedFetch, showError, showSuccess, trackEvent]
  );

  const handleMetadataSave = useCallback(async () => {
    if (!selectedNode) {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const trimmed = metadataDraft.trim();
      if (!trimmed) {
        parsed = {};
      } else {
        const candidate = JSON.parse(trimmed) as unknown;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error('Metadata must be a JSON object');
        }
        parsed = candidate as Record<string, unknown>;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Metadata must be valid JSON';
      setMetadataErrorMessage(message);
      showError('Metadata validation failed', err, message);
      return;
    }

    const original = (selectedNode.metadata ?? {}) as Record<string, unknown>;
    const toSet: Record<string, unknown> = {};
    const toUnset: string[] = [];
    let changed = false;

    for (const [key, value] of Object.entries(parsed)) {
      const originalValue = original[key];
      if (JSON.stringify(originalValue) !== JSON.stringify(value)) {
        toSet[key] = value;
        changed = true;
      }
    }

    for (const key of Object.keys(original)) {
      if (!(key in parsed)) {
        toUnset.push(key);
        changed = true;
      }
    }

    if (!changed) {
      setMetadataEditing(false);
      setMetadataErrorMessage(null);
      showInfo('No metadata changes detected');
      return;
    }

    setMetadataPending(true);
    setMetadataErrorMessage(null);

    try {
      await updateNodeMetadata(authorizedFetch, {
        nodeId: selectedNode.id,
        backendMountId: selectedNode.backendMountId,
        set: Object.keys(toSet).length > 0 ? toSet : undefined,
        unset: toUnset.length > 0 ? toUnset : undefined,
        idempotencyKey: `metadata-${selectedNode.id}-${Date.now()}`
      });
      setMetadataDraft(JSON.stringify(parsed, null, 2));
      setMetadataEditing(false);
      showSuccess('Metadata updated');
      scheduleRefresh('node', refetchNode);
      scheduleRefresh('list', refetchList);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update metadata';
      setMetadataErrorMessage(message);
      showError('Metadata update failed', err, message);
    } finally {
      setMetadataPending(false);
    }
  }, [
    authorizedFetch,
    metadataDraft,
    refetchList,
    refetchNode,
    scheduleRefresh,
    selectedNode,
    showError,
    showInfo,
    showSuccess
  ]);

  const handleDownload = useCallback(
    async (node: FilestoreNode, source: 'detail' | 'child') => {
      if (!node.download) {
        showError('Download unavailable', new Error('Download descriptor missing'));
        return;
      }

      if (node.download.mode === 'stream') {
        startDownload(node.id, 'stream');
        trackEvent('filestore.download.start', {
          nodeId: node.id,
          backendMountId: node.backendMountId,
          mode: 'stream',
          source
        });
        try {
          const streamUrl = new URL(node.download.streamUrl, FILESTORE_BASE_URL).toString();
          const response = await authorizedFetch(streamUrl, { method: 'GET' });
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(text || `Download failed with status ${response.status}`);
          }

          const contentLengthHeader = response.headers.get('Content-Length');
          const expectedBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : node.download.sizeBytes ?? null;
          let received = 0;
          let blob: Blob;

          if (response.body) {
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                chunks.push(value);
                received += value.length;
                if (expectedBytes && expectedBytes > 0) {
                  updateDownloadProgress(node.id, Math.min(received / expectedBytes, 1));
                }
              }
            }
            blob = new Blob(chunks, {
              type: response.headers.get('Content-Type') ?? 'application/octet-stream'
            });
          } else {
            const buffer = await response.arrayBuffer();
            received = buffer.byteLength;
            blob = new Blob([buffer], {
              type: response.headers.get('Content-Type') ?? 'application/octet-stream'
            });
            if (expectedBytes && expectedBytes > 0) {
              updateDownloadProgress(node.id, 1);
            }
          }

          if (typeof window !== 'undefined') {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = node.download.filename ?? node.name ?? 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }

          finishDownload(node.id);
          showSuccess('Download complete');
          trackEvent('filestore.download.success', {
            nodeId: node.id,
            backendMountId: node.backendMountId,
            mode: 'stream',
            source,
            bytes: received
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Download failed';
          failDownload(node.id, 'stream', message);
          showError('Download failed', error, message);
          trackEvent('filestore.download.failure', {
            nodeId: node.id,
            backendMountId: node.backendMountId,
            mode: 'stream',
            source,
            error: message
          });
        }
        return;
      }

      startDownload(node.id, 'presign');
      trackEvent('filestore.download.start', {
        nodeId: node.id,
        backendMountId: node.backendMountId,
        mode: 'presign',
        source
      });
      try {
        const presign = await presignNodeDownload(authorizedFetch, node.id);
        finishDownload(node.id);
        if (typeof window !== 'undefined') {
          window.open(presign.url, '_blank', 'noopener,noreferrer');
        }
        showSuccess('Presigned link opened');
        trackEvent('filestore.download.success', {
          nodeId: node.id,
          backendMountId: node.backendMountId,
          mode: 'presign',
          source
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Presign failed';
        failDownload(node.id, 'presign', message);
        showError('Presign failed', error, message);
        trackEvent('filestore.download.failure', {
          nodeId: node.id,
          backendMountId: node.backendMountId,
          mode: 'presign',
          source,
          error: message
        });
      }
    },
    [
      authorizedFetch,
      failDownload,
      finishDownload,
      showError,
      showSuccess,
      startDownload,
      trackEvent,
      updateDownloadProgress
    ]
  );

  const handlePaginationChange = useCallback(
    (nextOffset: number | null) => {
      if (nextOffset === null) {
        return;
      }
      setOffset(nextOffset);
    },
    []
  );

  const listErrorMessage = listError instanceof Error ? listError.message : null;
  const nodeErrorMessage = nodeError instanceof Error ? nodeError.message : null;
  const childrenErrorMessage = childrenError instanceof Error ? childrenError.message : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Filestore explorer</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Browse nodes, inspect rollups, monitor live activity, and trigger reconciliation runs.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Polling every 20s</span>
          <span aria-hidden="true">•</span>
          <button
            type="button"
            onClick={() => {
              void refetchList();
              void refetchNode();
              void refetchChildren();
            }}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
          >
            Refresh now
          </button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)_minmax(0,320px)]">
        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Mount & Filters</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="filestore-mount" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Backend mount ID
              </label>
              {mountsLoading ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Loading mounts…</p>
              ) : hasMountOptions ? (
                <div className="mt-1 flex gap-2">
                  <input
                    id="filestore-mount"
                    type="number"
                    min={1}
                    value={backendMountId ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (!raw) {
                        applyBackendMountSelection(null, 'input');
                        return;
                      }
                      const next = Number(raw);
                      if (Number.isFinite(next) && next > 0) {
                        applyBackendMountSelection(next, 'input');
                      }
                    }}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-slate-500"
                  />
                  <select
                    aria-label="Known mounts"
                    value={backendMountId ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (!raw) {
                        applyBackendMountSelection(null, 'select');
                        return;
                      }
                      const next = Number(raw);
                      if (Number.isFinite(next) && next > 0) {
                        applyBackendMountSelection(next, 'select');
                      }
                    }}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-slate-500"
                  >
                    {backendMountId === null ? (
                      <option value="" disabled>
                        Select a mount…
                      </option>
                    ) : null}
                    {mountOptions.map((option) => (
                      <option key={`mount-${option.id}`} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <p className="font-medium">No backend mounts detected.</p>
                  <p className="mt-1 text-xs">
                    Register a mount in the filestore service (see the repo docs) or via the CLI, then refresh this page.
                  </p>
                </div>
              )}
              {mountsError ? (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{mountsError}</p>
              ) : null}
            </div>

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleApplyPath(pathDraft);
              }}
            >
              <label htmlFor="filestore-path" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Path filter
              </label>
              <div className="flex gap-2">
                <input
                  id="filestore-path"
                  value={pathDraft}
                  onChange={(event) => setPathDraft(event.target.value)}
                  placeholder="datasets/observatory"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-slate-500"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:bg-white hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                >
                  Apply
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <label htmlFor="filestore-depth">Depth</label>
                  <input
                    id="filestore-depth"
                    type="number"
                    min={0}
                    max={6}
                    value={depth}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next >= 0) {
                        setDepth(next);
                        setOffset(0);
                      }
                    }}
                    className="w-16 rounded border border-slate-200 bg-transparent px-2 py-1 text-xs text-slate-600 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:text-slate-300"
                  />
                </div>
                {activePath ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActivePath(null);
                      setPathDraft('');
                      setOffset(0);
                    }}
                    className="text-xs font-medium text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </form>

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleApplySearch(searchDraft);
              }}
            >
              <label htmlFor="filestore-search" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Search nodes
              </label>
              <div className="flex gap-2">
                <input
                  id="filestore-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="owner:astro"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-slate-500"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:bg-white hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                >
                  Search
                </button>
              </div>
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm(null);
                    setSearchDraft('');
                    setOffset(0);
                  }}
                  className="text-xs font-medium text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  Clear search
                </button>
              ) : null}
            </form>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Node states</span>
                <button
                  type="button"
                  onClick={() => {
                    setStateFilters([]);
                    setOffset(0);
                  }}
                  className="text-xs text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  Reset
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {STATE_OPTIONS.map((state) => (
                  <button
                    key={`state-${state}`}
                    type="button"
                    onClick={() => handleToggleState(state)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      stateFilterSet.has(state)
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    {STATE_LABEL[state]}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={driftOnly}
                onChange={(event) => {
                  setDriftOnly(event.target.checked);
                  setOffset(0);
                }}
                className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              />
              Drift only
            </label>
          </div>

          <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <span>Nodes</span>
              <span>
                {pagination ? `${pagination.total} total` : listLoading ? 'Loading…' : `${nodes.length} loaded`}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {listLoading && nodes.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">Loading nodes…</div>
              ) : backendMountId === null ? (
                <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">
                  Select a backend mount to browse nodes.
                </div>
              ) : nodes.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">No nodes matched the current filters.</div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {nodes.map((node) => (
                    <li key={`node-${node.id}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedNodeId(node.id)}
                        className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition ${
                          selectedNodeId === node.id
                            ? 'bg-slate-900/5 hover:bg-slate-900/10 dark:bg-slate-100/10 dark:hover:bg-slate-100/15'
                            : 'hover:bg-slate-900/5 dark:hover:bg-slate-100/10'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {node.path}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATE_BADGE_CLASS[node.state]}`}>
                            {STATE_LABEL[node.state]}
                          </span>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>{KIND_LABEL[node.kind]}</span>
                          <span aria-hidden="true">•</span>
                          <span>{formatBytes(node.rollup?.sizeBytes ?? node.sizeBytes ?? 0)}</span>
                          <span aria-hidden="true">•</span>
                          <span>{CONSISTENCY_LABEL[node.consistencyState] ?? node.consistencyState}</span>
                          <span aria-hidden="true">•</span>
                          <span>Seen {formatTimestamp(node.lastSeenAt)}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {pagination ? (
              <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => handlePaginationChange(Math.max(pagination.offset - LIST_PAGE_SIZE, 0))}
                  disabled={pagination.offset === 0}
                  className="rounded-lg border border-slate-200 px-3 py-1 font-medium text-slate-600 transition disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                >
                  Previous
                </button>
                <span className="text-slate-500 dark:text-slate-400">
                  Page {Math.floor(pagination.offset / LIST_PAGE_SIZE) + 1}
                </span>
                <button
                  type="button"
                  onClick={() => handlePaginationChange(pagination.nextOffset)}
                  disabled={!pagination.nextOffset && pagination.nextOffset !== 0}
                  className="rounded-lg border border-slate-200 px-3 py-1 font-medium text-slate-600 transition disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
          {listErrorMessage ? (
            <p className="rounded-lg border border-rose-200/70 bg-rose-50/80 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/40 dark:text-rose-200">
              {listErrorMessage}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Node detail</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Metadata, rollup stats, and subdirectory inspection for the selected node.
              </p>
            </div>
            {selectedNode ? (
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase ${STATE_BADGE_CLASS[selectedNode.state]}`}>
                {STATE_LABEL[selectedNode.state]}
              </span>
            ) : null}
          </div>

          {nodeLoading && !selectedNode ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
              Loading node…
            </div>
          ) : !selectedNode ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
              Select a node from the list to view details.
            </div>
          ) : (
            <div className="space-y-4">
              <article className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                <dl className="grid gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Path</dt>
                    <dd className="mt-1 font-mono text-[13px] text-slate-800 dark:text-slate-100">{selectedNode.path}</dd>
                  </div>
                  {selectedNode.download ? (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Download</dt>
                      <dd className="mt-1 flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-200">
                        <button
                          type="button"
                          disabled={selectedDownloadState?.state === 'pending'}
                          onClick={() => void handleDownload(selectedNode, 'detail')}
                          className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
                        >
                          {selectedDownloadState?.state === 'pending'
                            ? selectedDownloadState.mode === 'stream'
                              ? 'Downloading…'
                              : 'Opening…'
                            : selectedNode.download.mode === 'stream'
                              ? 'Download file'
                              : 'Open download link'}
                        </button>
                        {selectedDownloadState?.mode === 'stream' &&
                        selectedDownloadState.state === 'pending' &&
                        typeof selectedDownloadState.progress === 'number' ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {Math.round(selectedDownloadState.progress * 100)}%
                          </span>
                        ) : null}
                      </dd>
                      {selectedDownloadState?.state === 'error' ? (
                        <dd className="mt-1 text-xs text-rose-600 dark:text-rose-400">{selectedDownloadState.error}</dd>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Backend</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">#{selectedNode.backendMountId}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Kind</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{KIND_LABEL[selectedNode.kind]}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Consistency</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{CONSISTENCY_LABEL[selectedNode.consistencyState] ?? selectedNode.consistencyState}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Version</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{selectedNode.version}</dd>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Last seen</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatTimestamp(selectedNode.lastSeenAt)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Last modified</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatTimestamp(selectedNode.lastModifiedAt)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Last reconciled</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatTimestamp(selectedNode.lastReconciledAt)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-slate-400 dark:text-slate-500">Last drift</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatTimestamp(selectedNode.lastDriftDetectedAt)}</dd>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Metadata</dt>
                      <button
                        type="button"
                        onClick={() => {
                          if (metadataEditing) {
                            setMetadataEditing(false);
                            setMetadataDraft(JSON.stringify(selectedNode.metadata ?? {}, null, 2));
                            setMetadataErrorMessage(null);
                          } else {
                            setMetadataEditing(true);
                          }
                        }}
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
                      >
                        {metadataEditing ? 'Discard changes' : 'Edit'}
                      </button>
                    </div>
                    <dd className="mt-1 max-h-60 overflow-y-auto rounded border border-slate-100 bg-slate-50/80 p-3 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                      {metadataEditing ? (
                        <div className="flex flex-col gap-3">
                          <textarea
                            value={metadataDraft}
                            onChange={(event) => setMetadataDraft(event.target.value)}
                            rows={8}
                            className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 dark:focus:border-slate-500"
                          />
                          {metadataErrorMessage ? (
                            <p className="text-xs text-rose-600 dark:text-rose-300">{metadataErrorMessage}</p>
                          ) : null}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={metadataPending}
                              onClick={() => void handleMetadataSave()}
                              className="rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900"
                            >
                              {metadataPending ? 'Saving…' : 'Save metadata'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMetadataEditing(false);
                                setMetadataDraft(JSON.stringify(selectedNode.metadata ?? {}, null, 2));
                                setMetadataErrorMessage(null);
                              }}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                          {JSON.stringify(selectedNode.metadata ?? {}, null, 2)}
                        </pre>
                      )}
                    </dd>
                  </div>
                </dl>
              </article>

              {playbookContext ? (
                playbook ? (
                  <article className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Drift playbook
                      </h4>
                      <span className="text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">
                        {STATE_LABEL[playbookContext.node.state]}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{playbook.summary}</p>
                    <div className="mt-3 space-y-3">
                      {playbook.actions.map((action) => {
                        if (action.type === 'reconcile') {
                          const actionKey = `playbook:${action.id}`;
                          const pending = pendingReconcileActionId === actionKey;
                          return (
                            <div
                              key={action.id}
                              className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/40"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="font-medium text-slate-700 dark:text-slate-200">{action.label}</p>
                                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{action.description}</p>
                                </div>
                                <button
                                  type="button"
                                  disabled={!hasWriteScope || pendingReconcileActionId !== null}
                                  onClick={() =>
                                    void enqueueReconcile(selectedNode, {
                                      reason: action.reason,
                                      detectChildren: action.detectChildren,
                                      requestHash: action.requestHash,
                                      actionId: actionKey,
                                      source: 'playbook',
                                      playbookId: playbook.id
                                    })
                                  }
                                  className="self-start rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900"
                                >
                                  {pending ? 'Enqueuing…' : 'Enqueue job'}
                                </button>
                              </div>
                            </div>
                          );
                        }
                        if (action.type === 'workflow') {
                          const workflowDefinition = workflowDefinitions[action.workflowSlug];
                          const pending = pendingWorkflowActionId === action.id;
                          const disabled =
                            !hasWriteScope || pendingWorkflowActionId !== null || !workflowDefinition;
                          const helperText = workflowsLoading
                            ? 'Loading workflows…'
                            : workflowDefinition
                              ? `Workflow: ${workflowDefinition.name}`
                              : workflowsError
                                ? workflowsError
                                : action.fallbackText ?? 'Workflow not available yet.';
                          return (
                            <div
                              key={action.id}
                              className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/40"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="font-medium text-slate-700 dark:text-slate-200">{action.label}</p>
                                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{action.description}</p>
                                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{helperText}</p>
                                </div>
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => void runPlaybookWorkflow(action, playbook.id, selectedNode)}
                                  className="self-start rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900"
                                >
                                  {pending ? 'Triggering…' : 'Trigger workflow'}
                                </button>
                              </div>
                            </div>
                          );
                        }
                        const href = action.href(playbookContext);
                        return (
                          <div
                            key={action.id}
                            className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/40"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-medium text-slate-700 dark:text-slate-200">{action.label}</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{action.description}</p>
                              </div>
                              <a
                                href={href}
                                target={action.external ? '_blank' : undefined}
                                rel={action.external ? 'noreferrer' : undefined}
                                onClick={() =>
                                  trackEvent('filestore.playbook.link_clicked', {
                                    playbookId: playbook.id,
                                    actionId: action.id,
                                    nodeId: selectedNode.id,
                                    backendMountId: selectedNode.backendMountId,
                                    state: selectedNode.state
                                  })
                                }
                                className="self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-slate-100"
                              >
                                Open
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {playbook.note ? (
                      <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500">{playbook.note}</p>
                    ) : null}
                  </article>
                ) : fallbackPlaybookMessage ? (
                  <article className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Drift playbook
                    </h4>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{fallbackPlaybookMessage}</p>
                  </article>
                ) : null
              ) : null}

              <article className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Rollup summary
                </h4>
                {selectedNode.rollup ? (
                  <dl className="grid grid-cols-2 gap-4 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-4">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Size</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatBytes(selectedNode.rollup.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Files</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{selectedNode.rollup.fileCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Directories</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{selectedNode.rollup.directoryCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Children</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{selectedNode.rollup.childCount}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-300">No rollup data available for this node.</p>
                )}
              </article>

              <article className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Immediate children</h4>
                  <button
                    type="button"
                    onClick={() => void refetchChildren()}
                    className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
                  >
                    Refresh
                  </button>
                </div>
                {childrenLoading && !childrenData ? (
                  <p className="text-sm text-slate-500 dark:text-slate-300">Loading children…</p>
                ) : childrenData && childrenData.children.length > 0 ? (
                  <ul className="divide-y divide-slate-100 border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                    {childrenData.children.map((child) => {
                      const childDownloadState = downloadStatusByNode[child.id];
                      return (
                        <li key={`child-${child.id}`} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-1 items-center gap-2">
                              <span className="truncate text-slate-700 dark:text-slate-200">{child.path}</span>
                              {child.download ? (
                                <button
                                  type="button"
                                  disabled={childDownloadState?.state === 'pending'}
                                  onClick={() => void handleDownload(child, 'child')}
                                  className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
                                >
                                  {childDownloadState?.state === 'pending'
                                    ? childDownloadState.mode === 'stream'
                                      ? 'Downloading…'
                                      : 'Opening…'
                                    : child.download.mode === 'stream'
                                      ? 'Download'
                                      : 'Open link'}
                                </button>
                              ) : null}
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATE_BADGE_CLASS[child.state]}`}>
                              {STATE_LABEL[child.state]}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span>{KIND_LABEL[child.kind]}</span>
                            <span aria-hidden="true">•</span>
                            <span>{formatBytes(child.rollup?.sizeBytes ?? child.sizeBytes ?? 0)}</span>
                            <span aria-hidden="true">•</span>
                            <span>Seen {formatTimestamp(child.lastSeenAt)}</span>
                          </div>
                          {childDownloadState?.mode === 'stream' &&
                          childDownloadState.state === 'pending' &&
                          typeof childDownloadState.progress === 'number' ? (
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Progress {Math.round(childDownloadState.progress * 100)}%
                            </div>
                          ) : null}
                          {childDownloadState?.state === 'error' ? (
                            <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{childDownloadState.error}</div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-300">No direct children recorded.</p>
                )}
                {childrenErrorMessage ? (
                  <p className="mt-2 rounded border border-rose-200/70 bg-rose-50/80 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/40 dark:text-rose-200">
                    {childrenErrorMessage}
                  </p>
                ) : null}
              </article>

              <article className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Reconciliation controls
                  </h4>
                  {!hasWriteScope ? (
                    <span className="text-[11px] font-semibold uppercase text-amber-600 dark:text-amber-300">Read only</span>
                  ) : null}
                </div>
                <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="filestore-reconcile-reason"
                        value="manual"
                        checked={reconcileReason === 'manual'}
                        onChange={() => setReconcileReason('manual')}
                      />
                      Manual
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="filestore-reconcile-reason"
                        value="drift"
                        checked={reconcileReason === 'drift'}
                        onChange={() => setReconcileReason('drift')}
                      />
                      Drift investigation
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="filestore-reconcile-reason"
                        value="audit"
                        checked={reconcileReason === 'audit'}
                        onChange={() => setReconcileReason('audit')}
                      />
                      Audit sweep
                    </label>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={reconcileDetectChildren}
                      onChange={(event) => setReconcileDetectChildren(event.target.checked)}
                    />
                    Detect and enqueue child nodes
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={reconcileRequestHash}
                      onChange={(event) => setReconcileRequestHash(event.target.checked)}
                    />
                    Request content hash calculation
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!hasWriteScope || pendingReconcileActionId !== null}
                  onClick={() =>
                    void enqueueReconcile(selectedNode ?? null, {
                      actionId: 'manual-controls',
                      source: 'manual-controls'
                    })
                  }
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900"
                >
                  {pendingReconcileActionId !== null ? 'Enqueuing…' : 'Enqueue reconciliation'}
                </button>
              </article>
            </div>
          )}
          {nodeErrorMessage ? (
            <p className="rounded-lg border border-rose-200/70 bg-rose-50/80 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/40 dark:text-rose-200">
              {nodeErrorMessage}
            </p>
          ) : null}
        </section>

        <section className="flex h-full flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Activity feed</h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">Live SSE updates</span>
          </div>
          <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60">
            {activity.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">Awaiting incoming events…</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {activity.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{entry.label}</span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">Mount {entry.backendMountId ?? '–'}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{entry.detail}</p>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{formatTimestamp(entry.timestamp)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
