import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  decodeFilestoreNodeFiltersParam,
  encodeFilestoreNodeFiltersParam,
  isFilestoreNodeFiltersEmpty,
  type FilestoreNodeFilters,
  type FilestoreRollupFilter,
  type FilestoreMetadataFilter
} from '@apphub/shared/filestoreFilters';
import { useAuth, type AuthIdentity } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { useToastHelpers } from '../components/toast';
import {
  copyNode,
  createDirectory,
  deleteNode,
  enqueueReconciliation,
  fetchNodeById,
  fetchNodeByPath,
  fetchNodeChildren,
  fetchReconciliationJob,
  listBackendMounts,
  listNodes,
  listReconciliationJobs,
  moveNode,
  presignNodeDownload,
  subscribeToFilestoreEvents,
  updateNodeMetadata,
  uploadFile,
  type FetchNodeChildrenParams,
  type FilestoreBackendMount,
  type FilestoreBackendMountState,
  type FilestoreEventType,
  type FilestoreNode,
  type FilestoreNodeChildren,
  type FilestoreNodeKind,
  type FilestoreNodeList,
  type FilestoreNodeState,
  type FilestorePagination,
  type FilestoreReconciliationReason,
  type FilestoreReconciliationJobDetail,
  type FilestoreReconciliationJobList,
  type FilestoreReconciliationJobStatus,
  type ListNodesParams,
  type ListReconciliationJobsParams
} from './api';
import { filestoreRollupStateSchema, type FilestoreRollupState } from './types';
import { FILESTORE_BASE_URL } from '../config';
import { formatBytes } from '../core/utils';
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
import { buildIdempotencyKey, normalizeRelativePath } from './commandForms';
import CreateDirectoryDialog from './components/CreateDirectoryDialog';
import UploadFileDialog from './components/UploadFileDialog';
import MoveCopyDialog from './components/MoveCopyDialog';
import DeleteNodeDialog from './components/DeleteNodeDialog';
import { useFilestorePreferences, type StoredNodeReference } from './hooks/useFilestorePreferences';

const LIST_PAGE_SIZE = 25;
const BROWSE_PAGE_SIZE = 200;
const TREE_ROOT_LIMIT = 200;
const TREE_CHILD_LIMIT = 200;
const ACTIVITY_LIMIT = 50;
const STATE_OPTIONS: FilestoreNodeState[] = ['active', 'inconsistent', 'missing', 'deleted', 'unknown'];
const EMPTY_NODE_LIST: FilestoreNode[] = [];
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
  active: 'bg-status-success-soft text-status-success shadow-elevation-sm',
  inconsistent: 'bg-status-warning-soft text-status-warning shadow-elevation-sm',
  missing: 'bg-status-danger-soft text-status-danger shadow-elevation-sm',
  deleted: 'bg-surface-muted text-muted shadow-elevation-sm',
  unknown: 'bg-surface-glass-soft text-secondary shadow-elevation-sm'
};
const MOUNT_STATE_LABEL: Record<FilestoreBackendMountState, string> = {
  active: 'Active',
  inactive: 'Inactive',
  offline: 'Offline',
  degraded: 'Degraded',
  error: 'Error',
  unknown: 'Unknown'
};
const MOUNT_STATE_BADGE_CLASS: Record<FilestoreBackendMountState, string> = {
  active: 'bg-status-success-soft text-status-success shadow-elevation-sm',
  inactive: 'bg-surface-muted text-muted shadow-elevation-sm',
  offline: 'bg-status-danger-soft text-status-danger shadow-elevation-sm',
  degraded: 'bg-status-warning-soft text-status-warning shadow-elevation-sm',
  error: 'bg-status-danger-soft text-status-danger shadow-elevation-sm',
  unknown: 'bg-surface-glass-soft text-secondary shadow-elevation-sm'
};
const JOB_STATUS_OPTIONS: FilestoreReconciliationJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled'
];
const JOB_STATUS_LABEL: Record<FilestoreReconciliationJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled'
};
const JOB_STATUS_BADGE_CLASS: Record<FilestoreReconciliationJobStatus, string> = {
  queued: 'bg-surface-glass-soft text-secondary shadow-elevation-sm',
  running: 'bg-status-info-soft text-status-info shadow-elevation-sm',
  succeeded: 'bg-status-success-soft text-status-success shadow-elevation-sm',
  failed: 'bg-status-danger-soft text-status-danger shadow-elevation-sm',
  skipped: 'bg-status-warning-soft text-status-warning shadow-elevation-sm',
  cancelled: 'bg-surface-muted text-muted shadow-elevation-sm'
};
const ROLLUP_STATE_OPTIONS: FilestoreRollupState[] = filestoreRollupStateSchema.options;
const ROLLUP_STATE_LABEL: Record<FilestoreRollupState, string> = {
  up_to_date: 'Up to date',
  pending: 'Pending',
  stale: 'Stale',
  invalid: 'Invalid'
};
const CONSISTENCY_LABEL: Record<string, string> = {
  active: 'Consistent',
  inconsistent: 'Drift',
  missing: 'Missing'
};
const PANEL_SURFACE = 'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg';
const CARD_SURFACE = 'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 shadow-elevation-sm';
const CARD_SURFACE_SOFT = 'rounded-2xl border border-subtle bg-surface-glass-soft px-4 py-3 shadow-elevation-sm';
const PRIMARY_ACTION_BUTTON =
  'rounded-full border border-accent bg-accent px-3 py-1.5 text-scale-xs font-weight-semibold text-on-accent shadow-elevation-sm transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY_ACTION_BUTTON =
  'rounded-full border border-subtle px-3 py-1.5 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60';
const DANGER_ACTION_BUTTON =
  'rounded-full border border-status-danger bg-status-danger px-3 py-1.5 text-scale-xs font-weight-semibold text-status-danger-on shadow-elevation-sm transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const FILTER_PILL_ACTIVE =
  `rounded-full border border-accent bg-accent px-3 py-1 text-scale-xs font-weight-medium text-on-accent shadow-elevation-sm transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const FILTER_PILL_INACTIVE =
  `rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-medium text-secondary shadow-elevation-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const FILTER_PILL_REMOVABLE =
  `inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs text-secondary shadow-elevation-sm transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`;
const CHECKBOX_INPUT =
  `h-4 w-4 rounded border border-subtle bg-surface-glass text-accent transition-colors ${FOCUS_RING}`;
const STATUS_BANNER_DANGER =
  'rounded-lg border border-status-danger bg-status-danger-soft px-3 py-2 text-scale-xs text-status-danger shadow-elevation-sm';
const VIEW_TOGGLE_CONTAINER =
  'inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-glass p-1 text-scale-xs shadow-elevation-sm';
const VIEW_TOGGLE_BUTTON =
  `rounded-full px-3 py-1 text-scale-xs font-weight-semibold transition-colors ${FOCUS_RING}`;
const VIEW_TOGGLE_BUTTON_ACTIVE = 'bg-accent text-on-accent shadow-elevation-sm';
const VIEW_TOGGLE_BUTTON_INACTIVE = 'text-secondary hover:text-accent';
const VIEW_STYLE_TOGGLE_ACTIVE = 'bg-surface-glass-soft text-primary shadow-elevation-sm';
const VIEW_STYLE_TOGGLE_INACTIVE = 'text-secondary hover:text-accent';
type EventCategory = 'nodes' | 'commands' | 'drift' | 'reconciliation' | 'downloads';

const EVENT_CATEGORY_ORDER: EventCategory[] = ['nodes', 'commands', 'drift', 'reconciliation', 'downloads'];

const EVENT_CATEGORY_DEFINITIONS: Record<
  EventCategory,
  { label: string; description: string; types: FilestoreEventType[] }
> = {
  nodes: {
    label: 'Node changes',
    description: 'Create, update, move, copy, and upload operations.',
    types: [
      'filestore.node.created',
      'filestore.node.updated',
      'filestore.node.deleted',
      'filestore.node.moved',
      'filestore.node.copied',
      'filestore.node.uploaded'
    ]
  },
  commands: {
    label: 'Commands',
    description: 'High-level command completion notifications.',
    types: ['filestore.command.completed']
  },
  drift: {
    label: 'Drift & inconsistencies',
    description: 'Detected drift and missing nodes.',
    types: ['filestore.drift.detected', 'filestore.node.missing']
  },
  reconciliation: {
    label: 'Reconciliation',
    description: 'Automated reconciliation outcomes and job status.',
    types: [
      'filestore.node.reconciled',
      'filestore.reconciliation.job.queued',
      'filestore.reconciliation.job.started',
      'filestore.reconciliation.job.completed',
      'filestore.reconciliation.job.failed',
      'filestore.reconciliation.job.cancelled'
    ]
  },
  downloads: {
    label: 'Downloads',
    description: 'Observed file download activity.',
    types: ['filestore.node.downloaded']
  }
};

const DEFAULT_EVENT_CATEGORY_STATE: Record<EventCategory, boolean> = {
  nodes: true,
  commands: true,
  drift: true,
  reconciliation: true,
  downloads: true
};
const MOUNT_STORAGE_KEY = 'apphub.filestore.selectedMountId';
const SHOULD_LOAD_PLAYBOOK_WORKFLOWS = playbooksRequireWorkflows(FILESTORE_DRIFT_PLAYBOOKS);
type RefreshTimers = {
  list: number | null;
  node: number | null;
  children: number | null;
  jobs: number | null;
  jobDetail: number | null;
};

type DownloadStatus = {
  state: 'pending' | 'error';
  mode: 'stream' | 'presign';
  progress?: number;
  error?: string;
};

type PendingCommand = {
  type: 'create' | 'upload' | 'move' | 'copy' | 'delete';
  key: string;
  path: string;
  mountId: number;
  description: string;
};

type TreeEntry = {
  node: FilestoreNode;
  expanded: boolean;
  loading: boolean;
  children: number[];
  error: string | null;
  hasLoadedChildren: boolean;
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

function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(2)} s`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

const SIZE_UNIT_MULTIPLIERS: Record<string, number> = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1024 ** 2,
  m: 1024 ** 2,
  gb: 1024 ** 3,
  g: 1024 ** 3,
  tb: 1024 ** 4,
  t: 1024 ** 4,
  pb: 1024 ** 5,
  p: 1024 ** 5
};

function parseByteSizeInput(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Value is required');
  }
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([a-zA-Z]*)$/);
  if (!match) {
    throw new Error('Use formats like 1024, 10GB, or 1.5TB');
  }
  const [, numericPart, unitPart] = match;
  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Size must be a non-negative number');
  }
  const unitKey = (unitPart || 'b').toLowerCase();
  const multiplier = SIZE_UNIT_MULTIPLIERS[unitKey];
  if (!multiplier) {
    throw new Error('Unknown size unit');
  }
  return Math.round(parsed * multiplier);
}

function parseMetadataValueInput(value: string): FilestoreMetadataFilter['value'] {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === 'true') {
    return true;
  }
  if (lowered === 'false') {
    return false;
  }
  if (lowered === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return trimmed;
}

function formatMetadataValueDisplay(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return String(value);
}

function toDateTimeLocalInput(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  return iso;
}
function buildListParams(input: {
  backendMountId: number;
  offset: number;
  limit: number;
  path: string | null;
  depth: number;
  states: FilestoreNodeState[];
  driftOnly: boolean;
  filters: FilestoreNodeFilters | null;
}): ListNodesParams {
  const filters = input.filters && !isFilestoreNodeFiltersEmpty(input.filters) ? input.filters : null;
  return {
    backendMountId: input.backendMountId,
    offset: input.offset,
    limit: input.limit,
    path: input.path,
    depth: input.path ? input.depth : null,
    search: filters?.query ?? null,
    states: input.states,
    driftOnly: input.driftOnly,
    filters
  };
}

function buildChildrenParams(input: {
  limit: number;
  states: FilestoreNodeState[];
  driftOnly: boolean;
  filters: FilestoreNodeFilters | null;
}): FetchNodeChildrenParams {
  const filters = input.filters && !isFilestoreNodeFiltersEmpty(input.filters) ? input.filters : null;
  return {
    limit: input.limit,
    states: input.states.length > 0 ? input.states : undefined,
    driftOnly: input.driftOnly || undefined,
    filters
  };
}

type FilestoreExplorerPageProps = {
  identity: AuthIdentity | null;
};

export default function FilestoreExplorerPage({ identity }: FilestoreExplorerPageProps) {
  const { activeToken } = useAuth();
  const authorizedFetch = useAuthorizedFetch();
  const { showError, showSuccess, showInfo } = useToastHelpers();
  const { trackEvent } = useAnalytics();
  const [searchParams, setSearchParams] = useSearchParams();
  const { viewMode, setViewMode, recents, starred, pushRecent, toggleStar, isStarred } = useFilestorePreferences();

  const authDisabled = identity?.authDisabled ?? false;
  const hasWriteScope =
    authDisabled || (identity?.scopes ? identity.scopes.includes('filestore:write') || identity.scopes.includes('filestore:admin') : false);
  const principal = identity?.subject ?? identity?.apiKeyId ?? identity?.userId ?? undefined;

  const [backendMountId, setBackendMountId] = useState<number | null>(null);
  const [mountsLoading, setMountsLoading] = useState(true);
  const [mountsError, setMountsError] = useState<string | null>(null);
  const [availableMounts, setAvailableMounts] = useState<FilestoreBackendMount[]>([]);
  const [mountSearch, setMountSearch] = useState('');
  const [extraMountIds, setExtraMountIds] = useState<number[]>([]);
  const [pathDraft, setPathDraft] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [depth, setDepth] = useState<number>(1);
  const [stateFilters, setStateFilters] = useState<FilestoreNodeState[]>([]);
  const [driftOnly, setDriftOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [jobStatusFilters, setJobStatusFilters] = useState<FilestoreReconciliationJobStatus[]>([]);
  const [jobPathDraft, setJobPathDraft] = useState('');
  const [jobPathFilter, setJobPathFilter] = useState<string | null>(null);
  const [jobListOffset, setJobListOffset] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [eventCategoryFilters, setEventCategoryFilters] = useState<Record<EventCategory, boolean>>(() => ({
    ...DEFAULT_EVENT_CATEGORY_STATE
  }));
  const [downloadStatusByNode, setDownloadStatusByNode] = useState<Record<number, DownloadStatus>>({});
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [browseViewStyle, setBrowseViewStyle] = useState<'grid' | 'list'>(() => 'grid');
  const [treeRoots, setTreeRoots] = useState<number[]>([]);
  const [treeEntries, setTreeEntries] = useState<Record<number, TreeEntry>>({});
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const treePathIndexRef = useRef<Map<string, number>>(new Map());

  const [advancedFilters, setAdvancedFilters] = useState<FilestoreNodeFilters>(() => {
    const parsed = decodeFilestoreNodeFiltersParam(searchParams.get('filters'));
    return parsed ?? {};
  });
  const [queryDraft, setQueryDraft] = useState<string>(() => advancedFilters.query ?? '');
  const debouncedQueryDraft = useDebouncedValue(queryDraft, 300);
  const [metadataKeyDraft, setMetadataKeyDraft] = useState('');
  const [metadataValueDraft, setMetadataValueDraft] = useState('');
  const [sizeMinDraft, setSizeMinDraft] = useState('');
  const [sizeMaxDraft, setSizeMaxDraft] = useState('');
  const [lastSeenAfterDraft, setLastSeenAfterDraft] = useState('');
  const [lastSeenBeforeDraft, setLastSeenBeforeDraft] = useState('');
  const [rollupStateDraft, setRollupStateDraft] = useState<FilestoreRollupState[]>(
    advancedFilters.rollup?.states ?? []
  );
  const [rollupMinChildDraft, setRollupMinChildDraft] = useState('');
  const [rollupMaxChildDraft, setRollupMaxChildDraft] = useState('');
  const [rollupLastCalculatedAfterDraft, setRollupLastCalculatedAfterDraft] = useState('');
  const [rollupLastCalculatedBeforeDraft, setRollupLastCalculatedBeforeDraft] = useState('');

  const refreshTimers = useRef<RefreshTimers>({ list: null, node: null, children: null, jobs: null, jobDetail: null });
  const pendingSelectionRef = useRef<{ mountId: number; path: string } | null>(null);
  const filtersEncodedRef = useRef<string>(encodeFilestoreNodeFiltersParam(advancedFilters) ?? '');

  useEffect(() => {
    const encoded = encodeFilestoreNodeFiltersParam(advancedFilters) ?? '';
    if (encoded === filtersEncodedRef.current) {
      return;
    }
    filtersEncodedRef.current = encoded;
    const nextParams = new URLSearchParams(window.location.search);
    if (encoded) {
      nextParams.set('filters', encoded);
    } else {
      nextParams.delete('filters');
    }
    setSearchParams(nextParams, { replace: true });
  }, [advancedFilters, setSearchParams]);

  useEffect(() => {
    const encoded = searchParams.get('filters') ?? '';
    if (encoded === filtersEncodedRef.current) {
      return;
    }
    filtersEncodedRef.current = encoded;
    const parsed = decodeFilestoreNodeFiltersParam(encoded);
    setAdvancedFilters(parsed ?? {});
  }, [searchParams]);

  useEffect(() => {
    setQueryDraft(advancedFilters.query ?? '');
    if (advancedFilters.size) {
      setSizeMinDraft(advancedFilters.size.min ? String(advancedFilters.size.min) : '');
      setSizeMaxDraft(advancedFilters.size.max ? String(advancedFilters.size.max) : '');
    } else {
      setSizeMinDraft('');
      setSizeMaxDraft('');
    }

    if (advancedFilters.lastSeenAt) {
      setLastSeenAfterDraft(toDateTimeLocalInput(advancedFilters.lastSeenAt.after ?? null));
      setLastSeenBeforeDraft(toDateTimeLocalInput(advancedFilters.lastSeenAt.before ?? null));
    } else {
      setLastSeenAfterDraft('');
      setLastSeenBeforeDraft('');
    }

    if (advancedFilters.rollup) {
      setRollupStateDraft(advancedFilters.rollup.states ?? []);
      setRollupMinChildDraft(
        typeof advancedFilters.rollup.minChildCount === 'number'
          ? String(advancedFilters.rollup.minChildCount)
          : ''
      );
      setRollupMaxChildDraft(
        typeof advancedFilters.rollup.maxChildCount === 'number'
          ? String(advancedFilters.rollup.maxChildCount)
          : ''
      );
      setRollupLastCalculatedAfterDraft(
        toDateTimeLocalInput(advancedFilters.rollup.lastCalculatedAfter ?? null)
      );
      setRollupLastCalculatedBeforeDraft(
        toDateTimeLocalInput(advancedFilters.rollup.lastCalculatedBefore ?? null)
      );
    } else {
      setRollupStateDraft([]);
      setRollupMinChildDraft('');
      setRollupMaxChildDraft('');
      setRollupLastCalculatedAfterDraft('');
      setRollupLastCalculatedBeforeDraft('');
    }
  }, [advancedFilters]);

  const enabledEventTypes = useMemo(() => {
    const seen = new Set<FilestoreEventType>();
    const types: FilestoreEventType[] = [];
    for (const category of EVENT_CATEGORY_ORDER) {
      if (!eventCategoryFilters[category]) {
        continue;
      }
      for (const type of EVENT_CATEGORY_DEFINITIONS[category].types) {
        if (!seen.has(type)) {
          seen.add(type);
          types.push(type);
        }
      }
    }
    return types;
  }, [eventCategoryFilters]);

  const enabledEventTypeSet = useMemo(() => new Set(enabledEventTypes), [enabledEventTypes]);
  const recentItems = useMemo(() => recents.slice(0, 5), [recents]);
  const starredItems = useMemo(() => starred.slice(0, 8), [starred]);
  const treeRootEntries = useMemo(
    () => treeRoots.map((id) => treeEntries[id]).filter((entry): entry is TreeEntry => Boolean(entry)),
    [treeEntries, treeRoots]
  );
  const browseBreadcrumbs = useMemo(() => {
    if (!activePath) {
      return [] as Array<{ label: string; path: string }>;
    }
    const segments = activePath.split('/');
    const crumbs: Array<{ label: string; path: string }> = [];
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      crumbs.push({ label: segment, path: prefix });
    }
    return crumbs;
  }, [activePath]);
  const visibleActivity = useMemo(
    () => activity.filter((entry) => enabledEventTypeSet.has(entry.type)),
    [activity, enabledEventTypeSet]
  );
  const sseActive = backendMountId !== null && enabledEventTypes.length > 0;
  const listIntervalMs = sseActive ? 45000 : 20000;
  const nodeIntervalMs = sseActive ? 40000 : 15000;
  const childrenIntervalMs = sseActive ? 45000 : 20000;
  const jobsIntervalMs = sseActive ? 30000 : 10000;
  const jobDetailIntervalMs = sseActive ? 30000 : 15000;

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

  const applyFilters = useCallback(
    (updater: (prev: FilestoreNodeFilters) => FilestoreNodeFilters) => {
      setAdvancedFilters((prev) => {
        const next = updater(prev);
        const prevEncoded = encodeFilestoreNodeFiltersParam(prev) ?? '';
        const nextEncoded = encodeFilestoreNodeFiltersParam(next) ?? '';
        if (prevEncoded !== nextEncoded) {
          setOffset(0);
          return next;
        }
        return prev;
      });
    },
    [setOffset]
  );

  const handleAddMetadataFilter = useCallback(() => {
    const key = metadataKeyDraft.trim();
    if (!key) {
      showError('Metadata key is required.', undefined, 'Metadata key is required.');
      return;
    }
    if ((advancedFilters.metadata?.length ?? 0) >= 16) {
      showError('You can only apply up to 16 metadata filters.', undefined, 'You can only apply up to 16 metadata filters.');
      return;
    }
    let parsedValue: FilestoreMetadataFilter['value'];
    try {
      parsedValue = parseMetadataValueInput(metadataValueDraft);
    } catch (err) {
      showError('Invalid metadata value', err, 'Invalid metadata value');
      return;
    }
    applyFilters((prev) => {
      const existing = prev.metadata ?? [];
      if (existing.some((entry) => entry.key === key && entry.value === parsedValue)) {
        return prev;
      }
      return {
        ...prev,
        metadata: [...existing, { key, value: parsedValue }]
      };
    });
    setMetadataKeyDraft('');
    setMetadataValueDraft('');
  }, [metadataKeyDraft, metadataValueDraft, applyFilters, showError, advancedFilters.metadata?.length]);

  const handleRemoveMetadataFilter = useCallback(
    (index: number) => {
      applyFilters((prev) => {
        if (!prev.metadata || index < 0 || index >= prev.metadata.length) {
          return prev;
        }
        const nextMetadata = prev.metadata.filter((_, idx) => idx !== index);
        const next = { ...prev } as FilestoreNodeFilters;
        if (nextMetadata.length === 0) {
          delete next.metadata;
        } else {
          next.metadata = nextMetadata;
        }
        return next;
      });
    },
    [applyFilters]
  );

  const handleClearMetadataFilters = useCallback(() => {
    if (!advancedFilters.metadata || advancedFilters.metadata.length === 0) {
      return;
    }
    applyFilters((prev) => {
      if (!prev.metadata || prev.metadata.length === 0) {
        return prev;
      }
      const next = { ...prev } as FilestoreNodeFilters;
      delete next.metadata;
      return next;
    });
  }, [applyFilters, advancedFilters.metadata]);

  const handleApplySizeFilter = useCallback(() => {
    const minInput = sizeMinDraft.trim();
    const maxInput = sizeMaxDraft.trim();
    if (!minInput && !maxInput) {
      applyFilters((prev) => {
        if (!prev.size) {
          return prev;
        }
        const next = { ...prev } as FilestoreNodeFilters;
        delete next.size;
        return next;
      });
      return;
    }
    let min: number | undefined;
    let max: number | undefined;
    try {
      if (minInput) {
        min = parseByteSizeInput(minInput);
      }
      if (maxInput) {
        max = parseByteSizeInput(maxInput);
      }
    } catch (err) {
      showError('Invalid size value', err, 'Invalid size value');
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      showError('Minimum size cannot exceed maximum size.', undefined, 'Minimum size cannot exceed maximum size.');
      return;
    }
    applyFilters((prev) => {
      const next = { ...prev } as FilestoreNodeFilters;
      const range = { ...(prev.size ?? {}) } as { min?: number; max?: number };
      if (min !== undefined) {
        range.min = min;
      } else {
        delete range.min;
      }
      if (max !== undefined) {
        range.max = max;
      } else {
        delete range.max;
      }
      if (Object.keys(range).length === 0) {
        delete next.size;
      } else {
        next.size = range;
      }
      return next;
    });
  }, [applyFilters, showError, sizeMinDraft, sizeMaxDraft]);

  const handleClearSizeFilter = useCallback(() => {
    applyFilters((prev) => {
      if (!prev.size) {
        return prev;
      }
      const next = { ...prev } as FilestoreNodeFilters;
      delete next.size;
      return next;
    });
    setSizeMinDraft('');
    setSizeMaxDraft('');
  }, [applyFilters]);

  const handleApplyLastSeenFilter = useCallback(() => {
    const afterInput = lastSeenAfterDraft.trim();
    const beforeInput = lastSeenBeforeDraft.trim();
    if (!afterInput && !beforeInput) {
      applyFilters((prev) => {
        if (!prev.lastSeenAt) {
          return prev;
        }
        const next = { ...prev } as FilestoreNodeFilters;
        delete next.lastSeenAt;
        return next;
      });
      return;
    }
    let afterIso: string | undefined;
    let beforeIso: string | undefined;
    if (afterInput) {
      const parsed = new Date(afterInput);
      if (Number.isNaN(parsed.getTime())) {
        showError('Invalid "seen after" timestamp.', undefined, 'Invalid "seen after" timestamp.');
        return;
      }
      afterIso = parsed.toISOString();
    }
    if (beforeInput) {
      const parsed = new Date(beforeInput);
      if (Number.isNaN(parsed.getTime())) {
        showError('Invalid "seen before" timestamp.', undefined, 'Invalid "seen before" timestamp.');
        return;
      }
      beforeIso = parsed.toISOString();
    }
    if (afterIso && beforeIso && new Date(afterIso) > new Date(beforeIso)) {
      showError('"Seen after" must be earlier than "seen before".', undefined, '"Seen after" must be earlier than "seen before".');
      return;
    }
    applyFilters((prev) => {
      const next = { ...prev } as FilestoreNodeFilters;
      const range = { ...(prev.lastSeenAt ?? {}) } as { after?: string; before?: string };
      if (afterIso) {
        range.after = afterIso;
      } else {
        delete range.after;
      }
      if (beforeIso) {
        range.before = beforeIso;
      } else {
        delete range.before;
      }
      if (Object.keys(range).length === 0) {
        delete next.lastSeenAt;
      } else {
        next.lastSeenAt = range;
      }
      return next;
    });
  }, [applyFilters, lastSeenAfterDraft, lastSeenBeforeDraft, showError]);

  const handleClearLastSeenFilter = useCallback(() => {
    applyFilters((prev) => {
      if (!prev.lastSeenAt) {
        return prev;
      }
      const next = { ...prev } as FilestoreNodeFilters;
      delete next.lastSeenAt;
      return next;
    });
    setLastSeenAfterDraft('');
    setLastSeenBeforeDraft('');
  }, [applyFilters]);

  const handleApplyRollupFilter = useCallback(() => {
    const stateSelection = rollupStateDraft;
    const minChildRaw = rollupMinChildDraft.trim();
    const maxChildRaw = rollupMaxChildDraft.trim();
    const afterRaw = rollupLastCalculatedAfterDraft.trim();
    const beforeRaw = rollupLastCalculatedBeforeDraft.trim();

    if (
      stateSelection.length === 0 &&
      !minChildRaw &&
      !maxChildRaw &&
      !afterRaw &&
      !beforeRaw
    ) {
      applyFilters((prev) => {
        if (!prev.rollup) {
          return prev;
        }
        const next = { ...prev } as FilestoreNodeFilters;
        delete next.rollup;
        return next;
      });
      return;
    }

    const parseNonNegativeInteger = (input: string, label: string): number => {
      const parsed = Number(input);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${label} must be a non-negative integer.`);
      }
      return parsed;
    };

    let minChild: number | undefined;
    let maxChild: number | undefined;
    try {
      if (minChildRaw) {
        minChild = parseNonNegativeInteger(minChildRaw, 'Minimum child count');
      }
      if (maxChildRaw) {
        maxChild = parseNonNegativeInteger(maxChildRaw, 'Maximum child count');
      }
    } catch (err) {
      showError('Invalid rollup child count', err, 'Invalid rollup child count');
      return;
    }

    if (minChild !== undefined && maxChild !== undefined && minChild > maxChild) {
      showError('Minimum child count cannot exceed maximum.', undefined, 'Minimum child count cannot exceed maximum.');
      return;
    }

    let afterIso: string | undefined;
    let beforeIso: string | undefined;
    if (afterRaw) {
      const parsed = new Date(afterRaw);
      if (Number.isNaN(parsed.getTime())) {
        showError('Invalid rollup recalculated-after timestamp.', undefined, 'Invalid rollup recalculated-after timestamp.');
        return;
      }
      afterIso = parsed.toISOString();
    }
    if (beforeRaw) {
      const parsed = new Date(beforeRaw);
      if (Number.isNaN(parsed.getTime())) {
        showError('Invalid rollup recalculated-before timestamp.', undefined, 'Invalid rollup recalculated-before timestamp.');
        return;
      }
      beforeIso = parsed.toISOString();
    }
    if (afterIso && beforeIso && new Date(afterIso) > new Date(beforeIso)) {
      showError('Rollup recalculated-after must be earlier than recalculated-before.', undefined, 'Rollup recalculated-after must be earlier than recalculated-before.');
      return;
    }

    applyFilters((prev) => {
      const next = { ...prev } as FilestoreNodeFilters;
      const rollup: FilestoreRollupFilter = { ...(prev.rollup ?? {}) };

      if (stateSelection.length > 0) {
        rollup.states = [...stateSelection];
      } else {
        delete rollup.states;
      }

      if (minChild !== undefined) {
        rollup.minChildCount = minChild;
      } else {
        delete rollup.minChildCount;
      }

      if (maxChild !== undefined) {
        rollup.maxChildCount = maxChild;
      } else {
        delete rollup.maxChildCount;
      }

      if (afterIso) {
        rollup.lastCalculatedAfter = afterIso;
      } else {
        delete rollup.lastCalculatedAfter;
      }

      if (beforeIso) {
        rollup.lastCalculatedBefore = beforeIso;
      } else {
        delete rollup.lastCalculatedBefore;
      }

      if (Object.keys(rollup).length === 0) {
        delete next.rollup;
      } else {
        next.rollup = rollup;
      }

      return next;
    });
  }, [applyFilters, rollupStateDraft, rollupMinChildDraft, rollupMaxChildDraft, rollupLastCalculatedAfterDraft, rollupLastCalculatedBeforeDraft, showError]);

  const handleClearRollupFilter = useCallback(() => {
    applyFilters((prev) => {
      if (!prev.rollup) {
        return prev;
      }
      const next = { ...prev } as FilestoreNodeFilters;
      delete next.rollup;
      return next;
    });
    setRollupStateDraft([]);
    setRollupMinChildDraft('');
    setRollupMaxChildDraft('');
    setRollupLastCalculatedAfterDraft('');
    setRollupLastCalculatedBeforeDraft('');
  }, [applyFilters]);

  const handleResetFilters = useCallback(() => {
    applyFilters(() => ({}));
    setQueryDraft('');
    setMetadataKeyDraft('');
    setMetadataValueDraft('');
    setSizeMinDraft('');
    setSizeMaxDraft('');
    setLastSeenAfterDraft('');
    setLastSeenBeforeDraft('');
    setRollupStateDraft([]);
    setRollupMinChildDraft('');
    setRollupMaxChildDraft('');
    setRollupLastCalculatedAfterDraft('');
    setRollupLastCalculatedBeforeDraft('');
  }, [applyFilters]);

  const listFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (backendMountId === null) {
        throw new Error('Backend mount not selected');
      }

      if (viewMode === 'browse') {
        const params = {
          backendMountId,
          offset: 0,
          limit: BROWSE_PAGE_SIZE,
          path: activePath,
          depth: 1,
          states: stateFilters.length > 0 ? stateFilters : undefined,
          driftOnly,
          filters: null,
          search: null
        };
        return listNodes(activeToken, params, { signal });
      }

      const params = buildListParams({
        backendMountId,
        offset,
        limit: LIST_PAGE_SIZE,
        path: activePath,
        depth,
        states: stateFilters,
        driftOnly,
        filters: advancedFilters
      });
      return listNodes(activeToken, params, { signal });
    },
    [activeToken, backendMountId, viewMode, activePath, stateFilters, driftOnly, advancedFilters, offset, depth]
  );

  const {
    data: listData,
    error: listError,
    loading: listLoading,
    refetch: refetchList
  } = usePollingResource<FilestoreNodeList>({
    fetcher: listFetcher,
    intervalMs: listIntervalMs,
    enabled: backendMountId !== null
  });

  const detailFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!selectedNodeId) {
        throw new Error('Node not selected');
      }
      return fetchNodeById(activeToken, selectedNodeId, { signal });
    },
    [activeToken, selectedNodeId]
  );

  const {
    data: selectedNode,
    error: nodeError,
    loading: nodeLoading,
    refetch: refetchNode
  } = usePollingResource<FilestoreNode>({
    fetcher: detailFetcher,
    intervalMs: nodeIntervalMs,
    enabled: selectedNodeId !== null
  });

  const childrenFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!selectedNodeId) {
        throw new Error('Node not selected');
      }
      const params = buildChildrenParams({
        limit: 50,
        states: stateFilters,
        driftOnly,
        filters: advancedFilters
      });
      return fetchNodeChildren(activeToken, selectedNodeId, params, { signal });
    },
    [activeToken, selectedNodeId, stateFilters, driftOnly, advancedFilters]
  );

  const {
    data: childrenData,
    loading: childrenLoading,
    error: childrenError,
    refetch: refetchChildren
  } = usePollingResource<FilestoreNodeChildren>({
    fetcher: childrenFetcher,
    intervalMs: childrenIntervalMs,
    enabled: selectedNodeId !== null
  });

  const jobsFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!hasWriteScope) {
        throw new Error('filestore:write scope required to list reconciliation jobs');
      }
      if (backendMountId === null) {
        throw new Error('Backend mount not selected');
      }
      const params: ListReconciliationJobsParams = {
        backendMountId,
        limit: 20,
        offset: jobListOffset,
        path: jobPathFilter,
        statuses: jobStatusFilters.length > 0 ? jobStatusFilters : undefined
      };
      return listReconciliationJobs(activeToken, params, { signal });
    },
    [activeToken, backendMountId, hasWriteScope, jobListOffset, jobPathFilter, jobStatusFilters]
  );

  const {
    data: jobListData,
    error: jobListError,
    loading: jobListLoading,
    refetch: refetchJobs
  } = usePollingResource<FilestoreReconciliationJobList>({
    fetcher: jobsFetcher,
    intervalMs: jobsIntervalMs,
    enabled: backendMountId !== null && hasWriteScope
  });

  const jobDetailFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!hasWriteScope) {
        throw new Error('filestore:write scope required to inspect reconciliation jobs');
      }
      if (selectedJobId === null) {
        throw new Error('Job not selected');
      }
      return fetchReconciliationJob(activeToken, selectedJobId, { signal });
    },
    [activeToken, hasWriteScope, selectedJobId]
  );

  const {
    data: jobDetailData,
    error: jobDetailError,
    loading: jobDetailLoading,
    refetch: refetchJobDetail
  } = usePollingResource<FilestoreReconciliationJobDetail>({
    fetcher: jobDetailFetcher,
    intervalMs: jobDetailIntervalMs,
    enabled: selectedJobId !== null && hasWriteScope,
    immediate: selectedJobId !== null
  });

  const selectedMount = useMemo(() => {
    if (backendMountId === null) {
      return null;
    }
    return availableMounts.find((mount) => mount.id === backendMountId) ?? null;
  }, [availableMounts, backendMountId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadMounts = async () => {
      setMountsLoading(true);
      setMountsError(null);
      try {
        const result = await listBackendMounts(activeToken, {}, { signal: controller.signal });
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
          const firstActive = result.mounts.find((mount) => mount.state === 'active');
          nextId = firstActive ? firstActive.id : result.mounts[0].id;
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
  }, [activeToken, showError]);

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
    if (backendMountId === null) {
      setTreeRoots([]);
      setTreeEntries({});
      setTreeError(null);
      treePathIndexRef.current = new Map();
    }
  }, [backendMountId]);

  useEffect(() => {
    if (backendMountId === null || viewMode !== 'browse') {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadRoots = async () => {
      setTreeLoading(true);
      setTreeError(null);
      try {
        const response = await listNodes(activeToken, {
          backendMountId,
          limit: TREE_ROOT_LIMIT,
          offset: 0,
          depth: 1,
          kinds: ['directory'],
          states: stateFilters.length > 0 ? stateFilters : undefined,
          driftOnly,
          filters: null,
          search: null,
          path: null
        });
        if (cancelled || controller.signal.aborted) {
          return;
        }

        const directories = response.nodes
          .filter((node) => node.kind === 'directory')
          .sort((a, b) => a.path.localeCompare(b.path));

        setTreeEntries((prev) => {
          const next = { ...prev };
          for (const directory of directories) {
            next[directory.id] = {
              node: directory,
              expanded: next[directory.id]?.expanded ?? false,
              loading: false,
              children: next[directory.id]?.children ?? [],
              error: null,
              hasLoadedChildren: next[directory.id]?.hasLoadedChildren ?? false
            } satisfies TreeEntry;
            treePathIndexRef.current.set(directory.path, directory.id);
          }
          return next;
        });
        setTreeRoots(directories.map((directory) => directory.id));
      } catch (err) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load directories';
        setTreeError(message);
      } finally {
        if (!cancelled) {
          setTreeLoading(false);
        }
      }
    };

    void loadRoots();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeToken, backendMountId, driftOnly, stateFilters, viewMode]);

  const loadDirectoryChildren = useCallback(
    async (parentId: number) => {
      setTreeEntries((prev) => {
        const entry = prev[parentId];
        if (!entry) {
          return prev;
        }
        if (entry.loading) {
          return prev;
        }
        return {
          ...prev,
          [parentId]: { ...entry, loading: true, error: null, expanded: true }
        } satisfies Record<number, TreeEntry>;
      });

      try {
        const response = await fetchNodeChildren(
          activeToken,
          parentId,
          {
            limit: TREE_CHILD_LIMIT,
            offset: 0,
            kinds: ['directory'],
            states: stateFilters.length > 0 ? stateFilters : undefined,
            driftOnly,
            filters: null,
            search: null
          },
          { signal: undefined }
        );

        const directories = response.children
          .filter((child) => child.kind === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name));

        setTreeEntries((prev) => {
          const next = { ...prev } as Record<number, TreeEntry>;
          const entry = next[parentId];
          if (!entry) {
            return prev;
          }
          entry.loading = false;
          entry.hasLoadedChildren = true;
          entry.error = null;
          entry.expanded = true;
          entry.children = directories.map((dir) => dir.id);

          for (const directory of directories) {
            next[directory.id] = {
              node: directory,
              expanded: next[directory.id]?.expanded ?? false,
              loading: next[directory.id]?.loading ?? false,
              children: next[directory.id]?.children ?? [],
              error: null,
              hasLoadedChildren: next[directory.id]?.hasLoadedChildren ?? false
            };
            treePathIndexRef.current.set(directory.path, directory.id);
          }

          return { ...next };
        });
      } catch (err) {
        setTreeEntries((prev) => {
          const entry = prev[parentId];
          if (!entry) {
            return prev;
          }
          return {
            ...prev,
            [parentId]: {
              ...entry,
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to load children'
            }
          } satisfies Record<number, TreeEntry>;
        });
      }
    },
    [activeToken, driftOnly, stateFilters]
  );

  const toggleTreeNode = useCallback(
    (nodeId: number) => {
      setTreeEntries((prev) => {
        const entry = prev[nodeId];
        if (!entry) {
          return prev;
        }
        if (entry.loading) {
          return prev;
        }
        if (entry.hasLoadedChildren) {
          return {
            ...prev,
            [nodeId]: { ...entry, expanded: !entry.expanded }
          } satisfies Record<number, TreeEntry>;
        }
        return prev;
      });

      const entry = treeEntries[nodeId];
      if (entry && !entry.hasLoadedChildren && !entry.loading) {
        void loadDirectoryChildren(nodeId);
      }
    },
    [loadDirectoryChildren, treeEntries]
  );

  useEffect(() => {
    if (viewMode !== 'browse') {
      return;
    }
    if (!activePath) {
      return;
    }
    const segments = activePath.split('/');
    let prefix = '';
    const toExpand: number[] = [];
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const nodeId = treePathIndexRef.current.get(prefix);
      if (nodeId) {
        toExpand.push(nodeId);
      }
    }
    if (toExpand.length === 0) {
      return;
    }
    setTreeEntries((prev) => {
      let next = prev;
      for (const id of toExpand) {
        const entry = next[id];
        if (!entry || entry.expanded) {
          continue;
        }
        if (next === prev) {
          next = { ...prev } as Record<number, TreeEntry>;
        }
        next[id] = { ...entry, expanded: true };
      }
      return next;
    });
    for (const id of toExpand) {
      const entry = treeEntries[id];
      if (entry && !entry.hasLoadedChildren && !entry.loading) {
        void loadDirectoryChildren(id);
      }
    }
  }, [activePath, loadDirectoryChildren, treeEntries, viewMode]);

  const renderTreeNodes = (ids: number[], depth = 0): JSX.Element[] => {
    const elements: JSX.Element[] = [];
    for (const id of ids) {
      const entry = treeEntries[id];
      if (!entry) {
        continue;
      }
      const isActive = activePath === entry.node.path;
      const isAncestor = activePath ? activePath.startsWith(`${entry.node.path}/`) : false;
      const isSelected = selectedNode?.path === entry.node.path;
      const hasChildren = entry.children.length > 0 || (entry.node.rollup?.directoryCount ?? 0) > 0;
      const labelClasses = isSelected
        ? 'text-accent font-weight-semibold'
        : isActive
          ? 'text-primary font-weight-medium'
          : isAncestor
            ? 'text-secondary font-weight-medium'
            : 'text-secondary';

      elements.push(
        <li key={`tree-node-${id}`} className="space-y-1">
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
            {hasChildren ? (
              <button
                type="button"
                aria-label={entry.expanded ? 'Collapse directory' : 'Expand directory'}
                onClick={() => toggleTreeNode(id)}
                className={`h-6 w-6 rounded border border-subtle bg-surface-glass text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
              >
                {entry.loading ? '…' : entry.expanded ? 'v' : '>'}
              </button>
            ) : (
              <span className="h-6 w-6" />
            )}
            <button
              type="button"
              onClick={() => openDirectory(entry.node.path, entry.node)}
              className={`flex-1 truncate rounded px-2 py-1 text-left text-scale-xs transition-colors hover:bg-surface-glass-soft ${FOCUS_RING} ${labelClasses}`}
            >
              {entry.node.name ?? entry.node.path.split('/').pop() ?? entry.node.path}
            </button>
          </div>
          {entry.error ? (
            <p className="pl-8 text-scale-xs text-status-danger">{entry.error}</p>
          ) : null}
          {entry.expanded ? (
            entry.loading ? (
              <p className="pl-8 text-scale-xs text-muted">Loading…</p>
            ) : entry.children.length > 0 ? (
              <ul className="space-y-1">{renderTreeNodes(entry.children, depth + 1)}</ul>
            ) : (
              <p className="pl-8 text-scale-xs text-muted">No subdirectories</p>
            )
          ) : null}
        </li>
      );
    }
    return elements;
  };


  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if ((event.key === 'b' || event.key === 'B') && event.shiftKey && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setViewMode('browse');
        return;
      }

      if ((event.key === 's' || event.key === 'S') && event.shiftKey && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setViewMode('search');
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }

      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const tagName = target.tagName.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
        return;
      }
      event.preventDefault();
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setViewMode]);

  useEffect(() => {
    if (!hasWriteScope) {
      setSelectedJobId(null);
      return;
    }
    setJobListOffset(0);
  }, [backendMountId, hasWriteScope, jobStatusFilters, jobPathFilter]);

  useEffect(() => {
    if (!jobListData || jobListData.jobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (selectedJobId === null || !jobListData.jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobListData.jobs[0].id);
    }
  }, [jobListData, selectedJobId]);

  useEffect(() => {
    if (!listData) {
      return;
    }
    const pending = pendingSelectionRef.current;
    if (!pending) {
      return;
    }
    if (listData.filters.backendMountId !== pending.mountId) {
      return;
    }
    const match = listData.nodes.find((node) => node.path === pending.path);
    if (match) {
      setSelectedNodeId(match.id);
      pendingSelectionRef.current = null;
    }
  }, [listData]);

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
    if (!selectedNode) {
      return;
    }
    pushRecent({
      backendMountId: selectedNode.backendMountId,
      path: selectedNode.path,
      kind: selectedNode.kind,
      displayName: selectedNode.name ?? selectedNode.path.split('/').pop() ?? selectedNode.path
    });
  }, [pushRecent, selectedNode]);

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

  const requestNodeSelection = useCallback(
    async (mountId: number, path: string, fallbackNode?: FilestoreNode | null) => {
      const normalizedPath = normalizeRelativePath(path);
      if (!normalizedPath) {
        pendingSelectionRef.current = null;
        return;
      }
      if (fallbackNode?.id) {
        setSelectedNodeId(fallbackNode.id);
        pendingSelectionRef.current = null;
        return;
      }
      try {
        const node = await fetchNodeByPath(activeToken, {
          backendMountId: mountId,
          path: normalizedPath
        });
        setSelectedNodeId(node.id);
        pendingSelectionRef.current = null;
      } catch {
        pendingSelectionRef.current = { mountId, path: normalizedPath };
      }
    },
    [activeToken]
  );

  const getParentPath = useCallback((path: string): string | null => {
    const normalized = normalizeRelativePath(path);
    if (!normalized) {
      return null;
    }
    const segments = normalized.split('/');
    segments.pop();
    if (segments.length === 0) {
      return null;
    }
    return segments.join('/');
  }, []);

  const applyBackendMountSelection = useCallback(
    (value: number | null, source: 'input' | 'select' | 'command') => {
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


  const handleCreateDirectoryCommand = useCallback(
    async (input: { path: string; metadata?: Record<string, unknown> }) => {
      if (backendMountId === null) {
        const error = new Error('Select a backend mount before creating directories.');
        showError('Failed to create directory', error);
        throw error;
      }
      if (!hasWriteScope) {
        const error = new Error('Filestore write scope required for this action.');
        showError('Failed to create directory', error);
        throw error;
      }

      const normalizedPath = normalizeRelativePath(input.path);
      if (!normalizedPath) {
        const error = new Error('Provide a directory path.');
        showError('Failed to create directory', error);
        throw error;
      }

      registerMountId(backendMountId);
      const key = buildIdempotencyKey('filestore-create');
      setPendingCommand({
        type: 'create',
        key,
        path: normalizedPath,
        mountId: backendMountId,
        description: `Creating ${normalizedPath}`
      });
      pendingSelectionRef.current = { mountId: backendMountId, path: normalizedPath };

      try {
        const response = await createDirectory(activeToken, {
          backendMountId,
          path: normalizedPath,
          metadata: input.metadata,
          idempotencyKey: key,
          principal
        });

        const parentPath = getParentPath(normalizedPath);
        if (activePath !== parentPath) {
          setActivePath(parentPath);
          setPathDraft(parentPath ?? '');
        }

        showSuccess('Directory creation requested');
        trackEvent('filestore.command.create_directory.success', {
          backendMountId,
          path: normalizedPath,
          idempotencyKey: key
        });

        await requestNodeSelection(backendMountId, normalizedPath, response.node ?? null);
        scheduleRefresh('list', refetchList);
        scheduleRefresh('node', refetchNode);
        scheduleRefresh('children', refetchChildren);
      } catch (error) {
        pendingSelectionRef.current = null;
        const message = error instanceof Error ? error.message : 'Failed to create directory';
        showError('Failed to create directory', error, message);
        trackEvent('filestore.command.create_directory.failure', {
          backendMountId,
          path: normalizedPath,
          idempotencyKey: key,
          error: message
        });
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setPendingCommand(null);
      }
    },
    [
      activePath,
      activeToken,
      backendMountId,
      getParentPath,
      hasWriteScope,
      principal,
      refetchChildren,
      refetchList,
      refetchNode,
      registerMountId,
      requestNodeSelection,
      scheduleRefresh,
      showError,
      showSuccess,
      trackEvent
    ]
  );

  const handleUploadFileCommand = useCallback(
    async (input: {
      path: string;
      file: File;
      overwrite: boolean;
      metadata?: Record<string, unknown>;
      checksum?: string;
    }) => {
      if (backendMountId === null) {
        const error = new Error('Select a backend mount before uploading files.');
        showError('Upload failed', error);
        throw error;
      }
      if (!hasWriteScope) {
        const error = new Error('Filestore write scope required for uploads.');
        showError('Upload failed', error);
        throw error;
      }

      const normalizedPath = normalizeRelativePath(input.path);
      if (!normalizedPath) {
        const error = new Error('Provide a destination path for the file.');
        showError('Upload failed', error);
        throw error;
      }

      registerMountId(backendMountId);
      const key = buildIdempotencyKey('filestore-upload');
      setPendingCommand({
        type: 'upload',
        key,
        path: normalizedPath,
        mountId: backendMountId,
        description: `Uploading ${normalizedPath}`
      });
      pendingSelectionRef.current = { mountId: backendMountId, path: normalizedPath };

      try {
        const response = await uploadFile(activeToken, {
          backendMountId,
          path: normalizedPath,
          file: input.file,
          overwrite: input.overwrite,
          metadata: input.metadata,
          checksum: input.checksum,
          idempotencyKey: key,
          principal
        });

        const parentPath = getParentPath(normalizedPath);
        if (activePath !== parentPath) {
          setActivePath(parentPath);
          setPathDraft(parentPath ?? '');
        }

        showSuccess('Upload queued');
        trackEvent('filestore.command.upload.success', {
          backendMountId,
          path: normalizedPath,
          idempotencyKey: key,
          size: input.file.size
        });

        await requestNodeSelection(backendMountId, normalizedPath, response.node ?? null);
        scheduleRefresh('list', refetchList);
        scheduleRefresh('node', refetchNode);
        scheduleRefresh('children', refetchChildren);
      } catch (error) {
        pendingSelectionRef.current = null;
        const message = error instanceof Error ? error.message : 'Upload failed';
        showError('Upload failed', error, message);
        trackEvent('filestore.command.upload.failure', {
          backendMountId,
          path: normalizedPath,
          idempotencyKey: key,
          error: message
        });
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setPendingCommand(null);
      }
    },
    [
      activePath,
      activeToken,
      backendMountId,
      getParentPath,
      hasWriteScope,
      principal,
      refetchChildren,
      refetchList,
      refetchNode,
      registerMountId,
      requestNodeSelection,
      scheduleRefresh,
      showError,
      showSuccess,
      trackEvent
    ]
  );

  const handleMoveNodeCommand = useCallback(
    async (input: { targetPath: string; targetMountId: number | null; overwrite: boolean }) => {
      if (!selectedNode) {
        const error = new Error('Select a node to move.');
        showError('Move failed', error);
        throw error;
      }
      if (!hasWriteScope) {
        const error = new Error('Filestore write scope required for this action.');
        showError('Move failed', error);
        throw error;
      }

      const sourceMountId = selectedNode.backendMountId;
      const targetMountId = input.targetMountId ?? sourceMountId;
      const normalizedPath = normalizeRelativePath(input.targetPath);
      if (!normalizedPath) {
        const error = new Error('Provide a destination path.');
        showError('Move failed', error);
        throw error;
      }

      registerMountId(sourceMountId);
      registerMountId(targetMountId);

      const key = buildIdempotencyKey('filestore-move');
      setPendingCommand({
        type: 'move',
        key,
        path: normalizedPath,
        mountId: targetMountId,
        description: `Moving to ${normalizedPath}`
      });
      pendingSelectionRef.current = { mountId: targetMountId, path: normalizedPath };

      try {
        const response = await moveNode(activeToken, {
          backendMountId: sourceMountId,
          path: selectedNode.path,
          targetBackendMountId: targetMountId === sourceMountId ? undefined : targetMountId,
          targetPath: normalizedPath,
          overwrite: input.overwrite,
          idempotencyKey: key,
          principal
        });

        showSuccess('Move enqueued');
        trackEvent('filestore.command.move.success', {
          sourceMountId,
          targetMountId,
          sourcePath: selectedNode.path,
          targetPath: normalizedPath,
          idempotencyKey: key
        });

        if (targetMountId !== backendMountId) {
          applyBackendMountSelection(targetMountId, 'command');
        } else {
          const parentPath = getParentPath(normalizedPath);
          if (activePath !== parentPath) {
            setActivePath(parentPath);
            setPathDraft(parentPath ?? '');
          }
        }

        await requestNodeSelection(targetMountId, normalizedPath, response.node ?? null);
        scheduleRefresh('list', refetchList);
        scheduleRefresh('node', refetchNode);
        scheduleRefresh('children', refetchChildren);
      } catch (error) {
        pendingSelectionRef.current = null;
        const message = error instanceof Error ? error.message : 'Move failed';
        showError('Move failed', error, message);
        trackEvent('filestore.command.move.failure', {
          sourceMountId,
          targetMountId,
          sourcePath: selectedNode.path,
          targetPath: normalizedPath,
          idempotencyKey: key,
          error: message
        });
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setPendingCommand(null);
      }
    },
    [
      activePath,
      applyBackendMountSelection,
      activeToken,
      backendMountId,
      getParentPath,
      hasWriteScope,
      principal,
      refetchChildren,
      refetchList,
      refetchNode,
      registerMountId,
      requestNodeSelection,
      scheduleRefresh,
      selectedNode,
      showError,
      showSuccess,
      trackEvent
    ]
  );

  const handleCopyNodeCommand = useCallback(
    async (input: { targetPath: string; targetMountId: number | null; overwrite: boolean }) => {
      if (!selectedNode) {
        const error = new Error('Select a node to copy.');
        showError('Copy failed', error);
        throw error;
      }
      if (!hasWriteScope) {
        const error = new Error('Filestore write scope required for this action.');
        showError('Copy failed', error);
        throw error;
      }

      const sourceMountId = selectedNode.backendMountId;
      const targetMountId = input.targetMountId ?? sourceMountId;
      const normalizedPath = normalizeRelativePath(input.targetPath);
      if (!normalizedPath) {
        const error = new Error('Provide a destination path.');
        showError('Copy failed', error);
        throw error;
      }

      registerMountId(sourceMountId);
      registerMountId(targetMountId);

      const key = buildIdempotencyKey('filestore-copy');
      setPendingCommand({
        type: 'copy',
        key,
        path: normalizedPath,
        mountId: targetMountId,
        description: `Copying to ${normalizedPath}`
      });
      pendingSelectionRef.current = { mountId: targetMountId, path: normalizedPath };

      try {
        const response = await copyNode(activeToken, {
          backendMountId: sourceMountId,
          path: selectedNode.path,
          targetBackendMountId: targetMountId === sourceMountId ? undefined : targetMountId,
          targetPath: normalizedPath,
          overwrite: input.overwrite,
          idempotencyKey: key,
          principal
        });

        showSuccess('Copy enqueued');
        trackEvent('filestore.command.copy.success', {
          sourceMountId,
          targetMountId,
          sourcePath: selectedNode.path,
          targetPath: normalizedPath,
          idempotencyKey: key
        });

        if (targetMountId !== backendMountId) {
          applyBackendMountSelection(targetMountId, 'command');
        } else {
          const parentPath = getParentPath(normalizedPath);
          if (activePath !== parentPath) {
            setActivePath(parentPath);
            setPathDraft(parentPath ?? '');
          }
        }

        await requestNodeSelection(targetMountId, normalizedPath, response.node ?? null);
        scheduleRefresh('list', refetchList);
        scheduleRefresh('node', refetchNode);
        scheduleRefresh('children', refetchChildren);
      } catch (error) {
        pendingSelectionRef.current = null;
        const message = error instanceof Error ? error.message : 'Copy failed';
        showError('Copy failed', error, message);
        trackEvent('filestore.command.copy.failure', {
          sourceMountId,
          targetMountId,
          sourcePath: selectedNode.path,
          targetPath: normalizedPath,
          idempotencyKey: key,
          error: message
        });
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setPendingCommand(null);
      }
    },
    [
      activePath,
      applyBackendMountSelection,
      activeToken,
      backendMountId,
      getParentPath,
      hasWriteScope,
      principal,
      refetchChildren,
      refetchList,
      refetchNode,
      registerMountId,
      requestNodeSelection,
      scheduleRefresh,
      selectedNode,
      showError,
      showSuccess,
      trackEvent
    ]
  );

  const handleDeleteNodeCommand = useCallback(
    async (input: { path: string; recursive: boolean }) => {
      if (!selectedNode) {
        const error = new Error('Select a node to delete.');
        showError('Delete failed', error);
        throw error;
      }
      if (!hasWriteScope) {
        const error = new Error('Filestore write scope required for this action.');
        showError('Delete failed', error);
        throw error;
      }

      const normalizedPath = normalizeRelativePath(input.path);
      if (!normalizedPath) {
        const error = new Error('Delete path unavailable.');
        showError('Delete failed', error);
        throw error;
      }

      const mountId = selectedNode.backendMountId;
      const key = buildIdempotencyKey('filestore-delete');
      setPendingCommand({
        type: 'delete',
        key,
        path: normalizedPath,
        mountId,
        description: `Deleting ${normalizedPath}`
      });

      try {
        await deleteNode(activeToken, {
          backendMountId: mountId,
          path: normalizedPath,
          recursive: input.recursive,
          idempotencyKey: key,
          principal
        });

        const parentPath = getParentPath(normalizedPath);
        showSuccess('Delete enqueued');
        trackEvent('filestore.command.delete.success', {
          backendMountId: mountId,
          path: normalizedPath,
          idempotencyKey: key,
          recursive: input.recursive
        });

        if (parentPath) {
          if (activePath !== parentPath) {
            setActivePath(parentPath);
            setPathDraft(parentPath ?? '');
          }
          pendingSelectionRef.current = { mountId, path: parentPath };
          await requestNodeSelection(mountId, parentPath);
        } else {
          setSelectedNodeId(null);
        }

        scheduleRefresh('list', refetchList);
        scheduleRefresh('node', refetchNode);
        scheduleRefresh('children', refetchChildren);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Delete failed';
        showError('Delete failed', error, message);
        trackEvent('filestore.command.delete.failure', {
          backendMountId: mountId,
          path: normalizedPath,
          idempotencyKey: key,
          recursive: input.recursive,
          error: message
        });
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setPendingCommand(null);
      }
    },
    [
      activePath,
      activeToken,
      getParentPath,
      hasWriteScope,
      principal,
      refetchChildren,
      refetchList,
      refetchNode,
      requestNodeSelection,
      scheduleRefresh,
      selectedNode,
      setSelectedNodeId,
      showError,
      showSuccess,
      trackEvent
    ]
  );

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
    if (backendMountId === null || enabledEventTypes.length === 0) {
      return;
    }

    const subscription = subscribeToFilestoreEvents(
      activeToken,
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

        if (
          event.type.startsWith('filestore.reconciliation.job') &&
          hasWriteScope &&
          backendMountId !== null &&
          'backendMountId' in event.data &&
          event.data.backendMountId === backendMountId
        ) {
          scheduleRefresh('jobs', refetchJobs);
          if (selectedJobId !== null && 'id' in event.data && event.data.id === selectedJobId) {
            scheduleRefresh('jobDetail', refetchJobDetail);
          }
        }
      },
      {
        backendMountId,
        pathPrefix: activePath ?? undefined,
        eventTypes: enabledEventTypes,
        onError: (error) => {
          showInfo(error.message ?? 'Filestore event stream closed, retrying shortly.');
        }
      }
    );

    return () => {
      subscription.close();
    };
  }, [
    activePath,
    activeToken,
    backendMountId,
    enabledEventTypes,
    refetchChildren,
    refetchList,
    refetchJobDetail,
    refetchJobs,
    refetchNode,
    registerMountId,
    scheduleRefresh,
    hasWriteScope,
    selectedNode?.path,
    selectedNodeId,
    selectedJobId,
    showInfo
  ]);

  const stateFilterSet = useMemo(() => new Set(stateFilters), [stateFilters]);
  const jobStatusFilterSet = useMemo(() => new Set(jobStatusFilters), [jobStatusFilters]);

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

  const handleToggleJobStatus = useCallback((status: FilestoreReconciliationJobStatus) => {
    setJobStatusFilters((prev) => {
      if (prev.includes(status)) {
        return prev.filter((value) => value !== status);
      }
      return [...prev, status];
    });
    setJobListOffset(0);
  }, []);

  const toggleEventCategory = useCallback((category: EventCategory) => {
    setEventCategoryFilters((prev) => ({
      ...prev,
      [category]: !prev[category]
    }));
  }, []);

  const handleApplyPath = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setActivePath(trimmed.length > 0 ? trimmed : null);
      setOffset(0);
    },
    []
  );

  const handleApplyJobPath = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setJobPathFilter(trimmed.length > 0 ? trimmed : null);
      setJobListOffset(0);
    },
    []
  );

  const handleApplyQuery = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      applyFilters((prev) => {
        if (trimmed.length === 0) {
          if (prev.query === undefined) {
            return prev;
          }
          const next = { ...prev } as FilestoreNodeFilters;
          delete next.query;
          return next;
        }
        if (prev.query === trimmed) {
          return prev;
        }
      return { ...prev, query: trimmed };
    });
  },
  [applyFilters]
);

  const handleGlobalSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handleApplyQuery(queryDraft);
      if (queryDraft.trim().length > 0) {
        setViewMode('search');
      }
    },
    [handleApplyQuery, queryDraft, setViewMode]
  );

  const handleClearGlobalSearch = useCallback(() => {
    if (queryDraft.length === 0) {
      return;
    }
    setQueryDraft('');
    handleApplyQuery('');
    setViewMode('browse');
  }, [handleApplyQuery, queryDraft, setViewMode]);

  useEffect(() => {
    handleApplyQuery(debouncedQueryDraft);
  }, [debouncedQueryDraft, handleApplyQuery]);

  useEffect(() => {
    if (debouncedQueryDraft.trim().length === 0) {
      return;
    }
    setViewMode('search');
  }, [debouncedQueryDraft, setViewMode]);

  useEffect(() => {
    if (viewMode === 'browse') {
      setOffset(0);
    }
  }, [viewMode]);

  const mountOptions = useMemo(() => {
    const base = availableMounts.map((mount) => {
      const kindLabel = mount.backendKind === 'local' ? 'Local' : 'S3';
      const displayName = mount.displayName ?? mount.mountKey;
      const stateSuffix = mount.state !== 'active' ? ` · ${MOUNT_STATE_LABEL[mount.state]}` : '';
      const searchTokens = [displayName, mount.mountKey, kindLabel, MOUNT_STATE_LABEL[mount.state]];
      if (mount.labels?.length) {
        searchTokens.push(...mount.labels);
      }
      return {
        id: mount.id,
        label: `${displayName} · ${kindLabel}${stateSuffix}`,
        searchValue: searchTokens.join(' ').toLowerCase(),
        state: mount.state
      };
    });
    const extras = extraMountIds
      .filter((id) => !availableMounts.some((mount) => mount.id === id))
      .map((id) => ({
        id,
        label: `Mount ${id}`,
        searchValue: `mount ${id}`,
        state: 'unknown' as FilestoreBackendMountState
      }));
    return [...base, ...extras].sort((a, b) => a.id - b.id);
  }, [availableMounts, extraMountIds]);

  const filteredMountOptions = useMemo(() => {
    const term = mountSearch.trim().toLowerCase();
    if (!term) {
      return mountOptions;
    }
    const filtered = mountOptions.filter((option) => option.searchValue.includes(term));
    if (backendMountId !== null && !filtered.some((option) => option.id === backendMountId)) {
      const selectedOption = mountOptions.find((option) => option.id === backendMountId);
      if (selectedOption) {
        return [selectedOption, ...filtered];
      }
    }
    return filtered;
  }, [mountOptions, mountSearch, backendMountId]);

  const hasMountOptions = mountOptions.length > 0;
  const advancedFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (advancedFilters.query) {
      chips.push({
        key: 'query',
        label: `query: "${advancedFilters.query}"`,
        onRemove: () => handleApplyQuery('')
      });
    }
    (advancedFilters.metadata ?? []).forEach((entry, index) => {
      chips.push({
        key: `metadata-${index}`,
        label: `metadata.${entry.key}=${formatMetadataValueDisplay(entry.value)}`,
        onRemove: () => handleRemoveMetadataFilter(index)
      });
    });
    if (advancedFilters.size) {
      const { min, max } = advancedFilters.size;
      const label =
        min !== undefined && max !== undefined
          ? `size ${formatBytes(min)} – ${formatBytes(max)}`
          : min !== undefined
            ? `size ≥ ${formatBytes(min)}`
            : max !== undefined
              ? `size ≤ ${formatBytes(max)}`
              : 'size';
      chips.push({ key: 'size', label, onRemove: handleClearSizeFilter });
    }
    if (advancedFilters.lastSeenAt) {
      const { after, before } = advancedFilters.lastSeenAt;
      const parts: string[] = [];
      if (after) {
        parts.push(`≥ ${formatTimestamp(after)}`);
      }
      if (before) {
        parts.push(`≤ ${formatTimestamp(before)}`);
      }
      chips.push({
        key: 'lastSeen',
        label: `seen ${parts.join(' ')} `.trim(),
        onRemove: handleClearLastSeenFilter
      });
    }
    if (advancedFilters.rollup) {
      const summaries: string[] = [];
      if (advancedFilters.rollup.states && advancedFilters.rollup.states.length > 0) {
        summaries.push(`state ${advancedFilters.rollup.states.map((state) => ROLLUP_STATE_LABEL[state]).join('/')}`);
      }
      if (typeof advancedFilters.rollup.minChildCount === 'number') {
        summaries.push(`child ≥ ${advancedFilters.rollup.minChildCount}`);
      }
      if (typeof advancedFilters.rollup.maxChildCount === 'number') {
        summaries.push(`child ≤ ${advancedFilters.rollup.maxChildCount}`);
      }
      if (advancedFilters.rollup.lastCalculatedAfter) {
        summaries.push(`recalc ≥ ${formatTimestamp(advancedFilters.rollup.lastCalculatedAfter)}`);
      }
      if (advancedFilters.rollup.lastCalculatedBefore) {
        summaries.push(`recalc ≤ ${formatTimestamp(advancedFilters.rollup.lastCalculatedBefore)}`);
      }
      chips.push({ key: 'rollup', label: `rollup ${summaries.join(' ')}`.trim(), onRemove: handleClearRollupFilter });
    }
    return chips;
  }, [
    advancedFilters,
    handleApplyQuery,
    handleRemoveMetadataFilter,
    handleClearSizeFilter,
    handleClearLastSeenFilter,
    handleClearRollupFilter
  ]);

  const hasAdvancedFilters = advancedFilterChips.length > 0;

  const pagination: FilestorePagination | null = listData?.pagination ?? null;
  const nodes = listData?.nodes ?? EMPTY_NODE_LIST;
  const browseNodes = useMemo(() => {
    if (viewMode !== 'browse') {
      return EMPTY_NODE_LIST;
    }
    const next = [...nodes];
    next.sort((a, b) => {
      if (a.kind !== b.kind) {
        if (a.kind === 'directory') {
          return -1;
        }
        if (b.kind === 'directory') {
          return 1;
        }
      }
      return (a.name ?? a.path).localeCompare(b.name ?? b.path);
    });
    return next;
  }, [nodes, viewMode]);
  const browseDirectories = useMemo(
    () => (viewMode === 'browse' ? browseNodes.filter((node) => node.kind === 'directory') : []),
    [browseNodes, viewMode]
  );
  const browseFiles = useMemo(
    () => (viewMode === 'browse' ? browseNodes.filter((node) => node.kind !== 'directory') : []),
    [browseNodes, viewMode]
  );
  const selectedDownloadState = selectedNode ? downloadStatusByNode[selectedNode.id] : undefined;
  const jobPagination = jobListData?.pagination ?? null;
  const jobList = jobListData?.jobs ?? [];
  const selectedJob = jobDetailData ?? null;
  const jobPageSize = jobPagination?.limit ?? 20;
  const writeDisabled = !hasWriteScope || backendMountId === null || pendingCommand !== null;
  const nodeWriteDisabled = writeDisabled || !selectedNode;

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
        await enqueueReconciliation(activeToken, {
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
      activeToken,
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
      await updateNodeMetadata(activeToken, {
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
    activeToken,
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
    async (node: FilestoreNode, source: 'detail' | 'child' | 'browse') => {
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
            const chunks: BlobPart[] = [];
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                const chunkCopy = new Uint8Array(value.byteLength);
                chunkCopy.set(value);
                chunks.push(chunkCopy.buffer);
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
        const presign = await presignNodeDownload(activeToken, node.id);
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
      activeToken,
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

  const selectPath = useCallback(
    (path: string, fallbackNode?: FilestoreNode | null) => {
      if (backendMountId === null) {
        return;
      }
      if (fallbackNode && fallbackNode.kind === 'directory') {
        setTreeEntries((prev) => {
          const next = { ...prev } as Record<number, TreeEntry>;
          next[fallbackNode.id] = {
            node: fallbackNode,
            expanded: next[fallbackNode.id]?.expanded ?? false,
            loading: next[fallbackNode.id]?.loading ?? false,
            children: next[fallbackNode.id]?.children ?? [],
            error: null,
            hasLoadedChildren: next[fallbackNode.id]?.hasLoadedChildren ?? false
          };
          treePathIndexRef.current.set(fallbackNode.path, fallbackNode.id);
          return next;
        });
      }
      void requestNodeSelection(backendMountId, path, fallbackNode ?? null);
    },
    [backendMountId, requestNodeSelection]
  );

  const openDirectory = useCallback(
    (path: string | null, fallbackNode?: FilestoreNode | null) => {
      if (viewMode !== 'browse') {
        setViewMode('browse');
      }
      if (path && path.trim().length > 0) {
        setPathDraft(path);
        handleApplyPath(path);
        selectPath(path, fallbackNode ?? null);
      } else {
        setPathDraft('');
        handleApplyPath('');
      }
    },
    [handleApplyPath, selectPath, setViewMode, viewMode]
  );

  const handleNavigateToReference = useCallback(
    (reference: StoredNodeReference) => {
      if (backendMountId === null) {
        showError('Select a backend mount before browsing', new Error('Backend mount not selected'));
        return;
      }
      if (reference.kind === 'directory') {
        openDirectory(reference.path);
        return;
      }
      const parentPath = getParentPath(reference.path);
      openDirectory(parentPath);
      selectPath(reference.path);
    },
    [backendMountId, getParentPath, openDirectory, selectPath, showError]
  );

  const handleBrowseItemClick = useCallback(
    (node: FilestoreNode) => {
      if (node.kind === 'directory') {
        openDirectory(node.path, node);
        return;
      }
      const parent = getParentPath(node.path);
      if (parent) {
        openDirectory(parent);
      } else {
        setViewMode('browse');
      }
      selectPath(node.path, node);
    },
    [getParentPath, openDirectory, selectPath, setViewMode]
  );

  const renderBrowseCard = (node: FilestoreNode): JSX.Element => {
    const downloadState = downloadStatusByNode[node.id];
    const isDirectory = node.kind === 'directory';
    const isSelected = selectedNodeId === node.id;
    return (
      <div
        key={`browse-card-${node.id}`}
        className={`rounded-xl border border-subtle p-3 transition-colors ${
          isSelected ? 'bg-surface-glass' : 'bg-surface-glass-soft hover:bg-surface-glass'
        }`}
      >
        <button
          type="button"
          onClick={() => handleBrowseItemClick(node)}
          className={`flex w-full flex-col gap-2 text-left ${FOCUS_RING}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-scale-sm font-weight-medium text-primary">
              {node.name ?? node.path.split('/').pop() ?? node.path}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-weight-semibold uppercase ${STATE_BADGE_CLASS[node.state]}`}>
              {STATE_LABEL[node.state]}
            </span>
          </div>
          <span className="truncate text-scale-xs text-muted">{node.path}</span>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>{KIND_LABEL[node.kind]}</span>
            <span aria-hidden="true">•</span>
            <span>{formatBytes(node.rollup?.sizeBytes ?? node.sizeBytes ?? 0)}</span>
            {!isDirectory ? (
              <>
                <span aria-hidden="true">•</span>
                <span>Seen {formatTimestamp(node.lastSeenAt)}</span>
              </>
            ) : null}
          </div>
        </button>
        {!isDirectory && node.download ? (
          <div className="mt-3 flex items-center justify-between text-scale-xs text-secondary">
            <button
              type="button"
              disabled={downloadState?.state === 'pending'}
              onClick={() => void handleDownload(node, 'browse')}
              className={`rounded-full border border-subtle px-3 py-1 font-weight-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
            >
              {downloadState?.state === 'pending'
                ? downloadState.mode === 'stream'
                  ? 'Downloading…'
                  : 'Opening…'
                : node.download.mode === 'stream'
                  ? 'Download'
                  : 'Open link'}
            </button>
            {downloadState?.state === 'pending' && typeof downloadState.progress === 'number' ? (
              <span className="text-muted">{Math.round(downloadState.progress * 100)}%</span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderBrowseRow = (node: FilestoreNode): JSX.Element => {
    const downloadState = downloadStatusByNode[node.id];
    const isDirectory = node.kind === 'directory';
    const isSelected = selectedNodeId === node.id;
    return (
      <li key={`browse-row-${node.id}`} className="border-b border-subtle last:border-none">
        <button
          type="button"
          onClick={() => handleBrowseItemClick(node)}
          className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${
            isSelected ? 'bg-surface-glass hover:bg-surface-glass-soft' : 'hover:bg-surface-glass-soft'
          } ${FOCUS_RING}`}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <span className="truncate text-scale-sm font-weight-medium text-primary">
              {node.path}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-weight-semibold uppercase ${STATE_BADGE_CLASS[node.state]}`}>
              {STATE_LABEL[node.state]}
            </span>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 text-scale-xs text-muted">
            <span>{KIND_LABEL[node.kind]}</span>
            <span aria-hidden="true">•</span>
            <span>{formatBytes(node.rollup?.sizeBytes ?? node.sizeBytes ?? 0)}</span>
            <span aria-hidden="true">•</span>
            <span>{CONSISTENCY_LABEL[node.consistencyState] ?? node.consistencyState}</span>
            <span aria-hidden="true">•</span>
            <span>Seen {formatTimestamp(node.lastSeenAt)}</span>
          </div>
        </button>
        {!isDirectory && node.download ? (
          <div className="flex items-center justify-between px-4 pb-2 text-scale-xs text-secondary">
            <button
              type="button"
              disabled={downloadState?.state === 'pending'}
              onClick={() => void handleDownload(node, 'browse')}
              className={`rounded-full border border-subtle px-3 py-1 font-weight-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
            >
              {downloadState?.state === 'pending'
                ? downloadState.mode === 'stream'
                  ? 'Downloading…'
                  : 'Opening…'
                : node.download.mode === 'stream'
                  ? 'Download'
                  : 'Open link'}
            </button>
            {downloadState?.state === 'pending' && typeof downloadState.progress === 'number' ? (
              <span className="text-muted">{Math.round(downloadState.progress * 100)}%</span>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  const handlePaginationChange = useCallback(
    (nextOffset: number | null) => {
      if (nextOffset === null) {
        return;
      }
      setOffset(nextOffset);
    },
    []
  );

  const handleJobPaginationChange = useCallback(
    (nextOffset: number | null) => {
      if (nextOffset === null) {
        return;
      }
      setJobListOffset(nextOffset);
    },
    []
  );

  const listErrorMessage = listError instanceof Error ? listError.message : null;
  const nodeErrorMessage = nodeError instanceof Error ? nodeError.message : null;
  const childrenErrorMessage = childrenError instanceof Error ? childrenError.message : null;
  const jobListErrorMessage = jobListError instanceof Error ? jobListError.message : null;
  const jobDetailErrorMessage = jobDetailError instanceof Error ? jobDetailError.message : null;
  const selectedNodePath = selectedNode?.path ?? null;
  const selectedNodeMountId = selectedNode?.backendMountId ?? null;
  const selectedNodeStarred = selectedNode
    ? isStarred(selectedNode.backendMountId, selectedNode.path)
    : false;
  const defaultDirectoryBasePath = selectedNode
    ? selectedNode.kind === 'directory'
      ? selectedNode.path
      : getParentPath(selectedNode.path)
    : activePath;
  const uploadBasePath = defaultDirectoryBasePath ?? activePath;
  const moveCopySourcePath = selectedNodePath;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-scale-xl font-weight-semibold text-primary">Filestore explorer</h2>
            <p className="text-scale-sm text-secondary">
              Browse nodes, inspect rollups, monitor live activity, and trigger reconciliation runs.
            </p>
          </div>
          <div className="flex items-center gap-2 text-scale-xs text-muted">
            <span>Polling every 20s</span>
            <span aria-hidden="true">•</span>
            <button
              type="button"
              onClick={() => {
                void refetchList();
                void refetchNode();
                void refetchChildren();
              }}
              className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              Refresh now
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={VIEW_TOGGLE_CONTAINER} role="tablist" aria-label="Filestore view mode">
            <button
              type="button"
              onClick={() => setViewMode('browse')}
              aria-pressed={viewMode === 'browse'}
              className={`${VIEW_TOGGLE_BUTTON} ${
                viewMode === 'browse' ? VIEW_TOGGLE_BUTTON_ACTIVE : VIEW_TOGGLE_BUTTON_INACTIVE
              }`}
            >
              Browse
            </button>
            <button
              type="button"
              onClick={() => setViewMode('search')}
              aria-pressed={viewMode === 'search'}
              className={`${VIEW_TOGGLE_BUTTON} ${
                viewMode === 'search' ? VIEW_TOGGLE_BUTTON_ACTIVE : VIEW_TOGGLE_BUTTON_INACTIVE
              }`}
            >
              Search
            </button>
          </div>
          <form className="flex min-w-[260px] flex-1 items-center gap-2" onSubmit={handleGlobalSearchSubmit}>
            <div className="relative flex-1">
              <input
                ref={searchInputRef}
                type="search"
                value={queryDraft}
                onChange={(event) => setQueryDraft(event.target.value)}
                placeholder="Search filestore (press /)"
                className={`w-full rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING}`}
              />
              {queryDraft.length > 0 ? (
                <button
                  type="button"
                  onClick={handleClearGlobalSearch}
                  className="absolute right-2 top-1.5 rounded-full px-2 py-1 text-[11px] font-weight-semibold text-secondary transition-colors hover:text-accent"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <button
              type="submit"
              className="rounded-full border border-subtle px-3 py-2 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              Apply
            </button>
          </form>
        </div>
      </header>

      {pendingCommand ? (
        <div className={`${CARD_SURFACE_SOFT} text-scale-sm text-secondary`}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-weight-semibold text-primary">Running filestore command…</span>
            <span className="font-mono text-scale-xs text-muted">{pendingCommand.key.slice(-12)}</span>
          </div>
          <p className="mt-1 text-scale-sm text-secondary">{pendingCommand.description}</p>
          <p className="mt-1 text-scale-xs text-muted">List and detail panes are read-only while the command completes.</p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)_minmax(0,320px)]">
        <section
          className={`flex flex-col gap-4 ${PANEL_SURFACE} transition ${
            pendingCommand ? 'pointer-events-none opacity-75' : ''
          }`}
          aria-busy={pendingCommand ? true : undefined}
        >
          <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.25em] text-muted">Mount & Filters</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="filestore-mount" className="text-scale-xs font-weight-medium text-muted">
                Backend mount
              </label>
              {mountsLoading ? (
                <p className="mt-2 text-scale-xs text-muted">Loading mounts…</p>
              ) : hasMountOptions ? (
                <div className="mt-2 space-y-2">
                  <input
                    id="filestore-mount-search"
                    value={mountSearch}
                    onChange={(event) => setMountSearch(event.target.value)}
                    placeholder="Search by name, key, or label"
                    className="w-full rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />
                  <select
                    id="filestore-mount"
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
                    className="w-full rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-secondary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {backendMountId === null ? (
                      <option value="" disabled>
                        Select a mount…
                      </option>
                    ) : null}
                    {filteredMountOptions.map((option) => (
                      <option key={`mount-${option.id}`} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {filteredMountOptions.length === 0 ? (
                    <p className="text-scale-xs text-muted">
                      No mounts matched “{mountSearch.trim()}”.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-subtle bg-surface-glass-soft px-4 py-3 text-scale-sm text-secondary">
                  <p className="font-weight-medium">No backend mounts detected.</p>
                  <p className="mt-1 text-scale-xs text-muted">
                    Register a mount in the filestore service (see the repo docs) or via the CLI, then refresh this page.
                  </p>
                </div>
              )}
              {mountsError ? <p className="mt-2 text-scale-xs text-status-danger">{mountsError}</p> : null}
            </div>
            <div>
              <h4 className="text-scale-xs font-weight-medium text-muted">Mount details</h4>
              {selectedMount ? (
                <div className={`mt-2 space-y-3 ${CARD_SURFACE}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-scale-sm font-weight-semibold text-primary">
                        {selectedMount.displayName ?? selectedMount.mountKey}
                      </p>
                      <p className="text-scale-xs text-muted">{selectedMount.mountKey}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${MOUNT_STATE_BADGE_CLASS[selectedMount.state]}`}
                    >
                      {MOUNT_STATE_LABEL[selectedMount.state]}
                    </span>
                  </div>
                  <dl className="space-y-2 text-scale-xs text-secondary">
                    <div>
                      <dt className="font-weight-medium text-muted">Access</dt>
                      <dd>{selectedMount.accessMode === 'rw' ? 'Read & write' : 'Read only'}</dd>
                    </div>
                    <div>
                      <dt className="font-weight-medium text-muted">Backend</dt>
                      <dd>{selectedMount.backendKind === 'local' ? 'Local filesystem' : 'Amazon S3'}</dd>
                    </div>
                    <div>
                      <dt className="font-weight-medium text-muted">Location</dt>
                      <dd>
                        {selectedMount.backendKind === 'local'
                          ? selectedMount.rootPath ?? '—'
                          : selectedMount.bucket
                            ? `${selectedMount.bucket}${selectedMount.prefix ? `/${selectedMount.prefix}` : ''}`
                            : '—'}
                      </dd>
                    </div>
                    {selectedMount.contact ? (
                      <div>
                        <dt className="font-weight-medium text-muted">Contact</dt>
                        <dd>{selectedMount.contact}</dd>
                      </div>
                    ) : null}
                    {selectedMount.labels.length > 0 ? (
                      <div>
                        <dt className="font-weight-medium text-muted">Labels</dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {selectedMount.labels.map((label) => (
                            <span
                              key={`mount-label-${label}`}
                              className="rounded-full bg-surface-glass px-2 py-0.5 text-[11px] font-weight-medium text-secondary"
                            >
                              {label}
                            </span>
                          ))}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {selectedMount.state !== 'active' ? (
                    <p className="text-scale-xs text-status-warning">
                      {selectedMount.stateReason ?? 'Mount is not active. Review backend health before writing data.'}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-scale-xs text-muted">Select a mount to view metadata.</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                disabled={writeDisabled}
                className={writeDisabled ? `${PRIMARY_ACTION_BUTTON} opacity-60` : PRIMARY_ACTION_BUTTON}
              >
                New directory
              </button>
              <button
                type="button"
                onClick={() => setShowUploadDialog(true)}
                disabled={writeDisabled}
                className={writeDisabled ? `${SECONDARY_ACTION_BUTTON} opacity-60` : SECONDARY_ACTION_BUTTON}
              >
                Upload file
              </button>
            </div>
            {!hasWriteScope ? (
              <p className="text-scale-xs text-status-danger">Filestore write scope is required for mutations.</p>
            ) : backendMountId === null ? (
              <p className="text-scale-xs text-muted">Select a backend mount to enable write actions.</p>
            ) : null}

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleApplyPath(pathDraft);
              }}
            >
              <label htmlFor="filestore-path" className="text-scale-xs font-weight-medium text-muted">
                Path filter
              </label>
              <div className="flex gap-2">
                <input
                  id="filestore-path"
                  value={pathDraft}
                  onChange={(event) => setPathDraft(event.target.value)}
                  placeholder="datasets/observatory"
                  className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed"
                >
                  Apply
                </button>
              </div>
              <div className="flex items-center justify-between text-scale-xs text-muted">
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
                    className="w-16 rounded border border-subtle bg-transparent px-2 py-1 text-scale-xs text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                    className="text-scale-xs font-weight-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-accent"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </form>

            {viewMode === 'browse' ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-scale-xs font-weight-medium text-muted">Recent items</h4>
                    {recentItems.length > 0 ? (
                      <span className="text-[10px] text-muted">Last {recentItems.length}</span>
                    ) : null}
                  </div>
                  {recentItems.length === 0 ? (
                    <p className="mt-2 text-scale-xs text-muted">Browse nodes to build your recent history.</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {recentItems.map((item) => (
                        <li key={`recent-${item.backendMountId}-${item.path}`}>
                          <button
                            type="button"
                            onClick={() => handleNavigateToReference(item)}
                            className={`w-full rounded-lg px-2 py-1 text-left text-scale-xs transition-colors hover:bg-surface-glass-soft ${FOCUS_RING} ${
                              selectedNode?.path === item.path ? 'bg-surface-glass-soft text-primary' : 'text-secondary'
                            }`}
                          >
                            <span className="block truncate">{item.displayName}</span>
                            <span className="block text-[10px] text-muted">
                              Mount {item.backendMountId} · {item.kind === 'directory' ? 'Directory' : 'File'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-scale-xs font-weight-medium text-muted">Starred</h4>
                    {starredItems.length > 0 ? (
                      <span className="text-[10px] text-muted">{starredItems.length} saved</span>
                    ) : null}
                  </div>
                  {starredItems.length === 0 ? (
                    <p className="mt-2 text-scale-xs text-muted">Star important paths to pin them here.</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {starredItems.map((item) => (
                        <li key={`star-${item.backendMountId}-${item.path}`} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleNavigateToReference(item)}
                            className={`flex-1 rounded-lg px-2 py-1 text-left text-scale-xs transition-colors hover:bg-surface-glass-soft ${FOCUS_RING} ${
                              selectedNode?.path === item.path ? 'bg-surface-glass-soft text-primary' : 'text-secondary'
                            }`}
                          >
                            <span className="block truncate">{item.displayName}</span>
                            <span className="block text-[10px] text-muted">
                              Mount {item.backendMountId} · {item.kind === 'directory' ? 'Directory' : 'File'}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Remove star"
                            onClick={() =>
                              toggleStar({
                                backendMountId: item.backendMountId,
                                path: item.path,
                                kind: item.kind,
                                displayName: item.displayName
                              })
                            }
                            className={`h-7 w-7 rounded-full border border-subtle text-scale-xs text-secondary transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-scale-xs font-weight-medium text-muted">Directory tree</h4>
                    <button
                      type="button"
                      onClick={() => openDirectory(null)}
                      className={`rounded-full border border-subtle px-2 py-1 text-[10px] font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
                    >
                      Go to root
                    </button>
                  </div>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-subtle bg-surface-glass-soft px-2 py-2">
                    {treeLoading && treeRootEntries.length === 0 ? (
                      <p className="px-2 py-2 text-scale-xs text-secondary">Loading directories…</p>
                    ) : treeRootEntries.length === 0 ? (
                      <p className="px-2 py-2 text-scale-xs text-muted">No directories discovered yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {renderTreeNodes(treeRootEntries.map((entry) => entry.node.id))}
                      </ul>
                    )}
                  </div>
                  {treeError ? <p className="mt-2 text-scale-xs text-status-danger">{treeError}</p> : null}
                </div>
              </div>
            ) : null}

            {viewMode === 'search' ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-scale-xs font-weight-medium text-muted">Advanced filters</span>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
                    >
                      Reset all
                    </button>
                  </div>
                  {hasAdvancedFilters ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {advancedFilterChips.map((chip) => (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={chip.onRemove}
                          className={FILTER_PILL_REMOVABLE}
                        >
                          <span>{chip.label}</span>
                          <span aria-hidden="true">×</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-scale-xs text-muted">No advanced filters applied.</p>
                  )}
                </div>

                <CollapsibleSection
                  title="Configure advanced filters"
                  description="Add metadata, size, time, and rollup constraints to refine the node list."
                  defaultOpen={hasAdvancedFilters}
                  contentClassName="space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-scale-xs font-weight-medium text-muted">Metadata filters</span>
                      {advancedFilters.metadata && advancedFilters.metadata.length > 0 ? (
                        <button
                          type="button"
                          onClick={handleClearMetadataFilters}
                          className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
                        >
                          Clear metadata
                        </button>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={metadataKeyDraft}
                        onChange={(event) => setMetadataKeyDraft(event.target.value)}
                        placeholder="key"
                        className={`w-28 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING}`}
                      />
                      <input
                        value={metadataValueDraft}
                        onChange={(event) => setMetadataValueDraft(event.target.value)}
                        placeholder="value"
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={handleAddMetadataFilter}
                        className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleApplySizeFilter();
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <label htmlFor="filestore-size-min" className="text-scale-xs font-weight-medium text-muted">
                        Size (bytes)
                      </label>
                      {advancedFilters.size ? (
                        <button
                          type="button"
                          onClick={handleClearSizeFilter}
                          className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
                        >
                          Clear size
                        </button>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <input
                        id="filestore-size-min"
                        value={sizeMinDraft}
                        onChange={(event) => setSizeMinDraft(event.target.value)}
                        placeholder="Min (e.g. 10GB)"
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <input
                        value={sizeMaxDraft}
                        onChange={(event) => setSizeMaxDraft(event.target.value)}
                        placeholder="Max"
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed"
                      >
                        Apply
                      </button>
                    </div>
                  </form>

                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleApplyLastSeenFilter();
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <label className="text-scale-xs font-weight-medium text-muted">
                        Last seen window
                      </label>
                      {advancedFilters.lastSeenAt ? (
                        <button
                          type="button"
                          onClick={handleClearLastSeenFilter}
                          className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
                        >
                          Clear last seen
                        </button>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="datetime-local"
                        value={lastSeenAfterDraft}
                        onChange={(event) => setLastSeenAfterDraft(event.target.value)}
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <input
                        type="datetime-local"
                        value={lastSeenBeforeDraft}
                        onChange={(event) => setLastSeenBeforeDraft(event.target.value)}
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed"
                      >
                        Apply
                      </button>
                    </div>
                  </form>

                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleApplyRollupFilter();
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <label className="text-scale-xs font-weight-medium text-muted">
                        Rollup filters
                      </label>
                      {advancedFilters.rollup ? (
                        <button
                          type="button"
                          onClick={handleClearRollupFilter}
                          className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
                        >
                          Clear rollup
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ROLLUP_STATE_OPTIONS.map((state) => {
                        const active = rollupStateDraft.includes(state);
                        return (
                          <button
                            key={`rollup-state-${state}`}
                            type="button"
                            onClick={() => {
                              setRollupStateDraft((prev) => {
                                if (prev.includes(state)) {
                                  return prev.filter((value) => value !== state);
                                }
                                return [...prev, state];
                              });
                            }}
                            className={active ? FILTER_PILL_ACTIVE : FILTER_PILL_INACTIVE}
                          >
                            {ROLLUP_STATE_LABEL[state]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={rollupMinChildDraft}
                        onChange={(event) => setRollupMinChildDraft(event.target.value)}
                        placeholder="Min children"
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <input
                        value={rollupMaxChildDraft}
                        onChange={(event) => setRollupMaxChildDraft(event.target.value)}
                        placeholder="Max children"
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="datetime-local"
                        value={rollupLastCalculatedAfterDraft}
                        onChange={(event) => setRollupLastCalculatedAfterDraft(event.target.value)}
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                      />
                      <input
                        type="datetime-local"
                        value={rollupLastCalculatedBeforeDraft}
                        onChange={(event) => setRollupLastCalculatedBeforeDraft(event.target.value)}
                        className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible-outline-offset-2 focus-visible-outline-accent disabled:cursor-not-allowed"
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed"
                      >
                        Apply
                      </button>
                    </div>
                  </form>
                </CollapsibleSection>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-scale-xs font-weight-medium text-muted">Node states</span>
                <button
                  type="button"
                  onClick={() => {
                    setStateFilters([]);
                    setOffset(0);
                  }}
                  className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
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
                    className={stateFilterSet.has(state) ? FILTER_PILL_ACTIVE : FILTER_PILL_INACTIVE}
                  >
                    {STATE_LABEL[state]}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-scale-xs font-weight-medium text-muted">
              <input
                type="checkbox"
                checked={driftOnly}
                onChange={(event) => {
                  setDriftOnly(event.target.checked);
                  setOffset(0);
                }}
                className={CHECKBOX_INPUT}
              />
              Drift only
            </label>
          </div>

        </section>

        <section className={`flex flex-col gap-4 ${PANEL_SURFACE}`}>
          {viewMode === 'browse' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.25em] text-muted">
                    Directory explorer
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-scale-xs text-secondary">
                    <button
                      type="button"
                      onClick={() => openDirectory(null)}
                      className={`rounded-full border border-subtle px-2 py-0.5 transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
                    >
                      Root
                    </button>
                    {browseBreadcrumbs.map((crumb) => (
                      <span key={`crumb-${crumb.path}`} className="flex items-center gap-1">
                        <span aria-hidden="true">/</span>
                        <button
                          type="button"
                          onClick={() => openDirectory(crumb.path)}
                          className={`rounded-full px-2 py-0.5 transition-colors hover:bg-surface-glass-soft ${FOCUS_RING}`}
                        >
                          {crumb.label}
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-scale-xs text-muted">
                    {backendMountId === null
                      ? 'Select a backend mount to browse contents.'
                      : `${browseNodes.length} item${browseNodes.length === 1 ? '' : 's'} loaded`}
                  </p>
                </div>
                <div className={VIEW_TOGGLE_CONTAINER} role="tablist" aria-label="Browse view style">
                  <button
                    type="button"
                    onClick={() => setBrowseViewStyle('grid')}
                    aria-pressed={browseViewStyle === 'grid'}
                    className={`${VIEW_TOGGLE_BUTTON} ${
                      browseViewStyle === 'grid' ? VIEW_STYLE_TOGGLE_ACTIVE : VIEW_STYLE_TOGGLE_INACTIVE
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowseViewStyle('list')}
                    aria-pressed={browseViewStyle === 'list'}
                    className={`${VIEW_TOGGLE_BUTTON} ${
                      browseViewStyle === 'list' ? VIEW_STYLE_TOGGLE_ACTIVE : VIEW_STYLE_TOGGLE_INACTIVE
                    }`}
                  >
                    List
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-subtle bg-surface-glass-soft p-4">
                {backendMountId === null ? (
                  <p className="text-scale-sm text-secondary">Select a backend mount to browse nodes.</p>
                ) : listLoading && browseNodes.length === 0 ? (
                  <p className="text-scale-sm text-secondary">Loading directory contents…</p>
                ) : browseNodes.length === 0 ? (
                  <p className="text-scale-sm text-secondary">This directory is empty.</p>
                ) : browseViewStyle === 'grid' ? (
                  <div className="max-h-[560px] overflow-y-auto pr-1">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {browseDirectories.map((node) => renderBrowseCard(node))}
                      {browseFiles.map((node) => renderBrowseCard(node))}
                    </div>
                  </div>
                ) : (
                  <div className="max-h-[560px] overflow-y-auto">
                    <ul className="divide-y divide-subtle rounded-xl border border-subtle bg-surface-glass-soft">
                      {[...browseDirectories, ...browseFiles].map((node) => renderBrowseRow(node))}
                    </ul>
                  </div>
                )}
              </div>
              {listErrorMessage ? <p className={STATUS_BANNER_DANGER}>{listErrorMessage}</p> : null}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.25em] text-muted">
                    Search results
                  </h3>
                  <p className="mt-1 text-scale-xs text-muted">
                    {listLoading && nodes.length === 0
                      ? 'Loading…'
                      : pagination
                        ? `${pagination.total} total matches`
                        : `${nodes.length} loaded`}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-subtle bg-surface-glass-soft">
                <div className="flex items-center justify-between border-b border-subtle bg-surface-glass px-4 py-3 text-scale-xs font-weight-medium text-muted">
                  <span>Matches</span>
                  <span>
                    {pagination
                      ? `${pagination.total} total`
                      : listLoading
                        ? 'Loading…'
                        : `${nodes.length} loaded`}
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {listLoading && nodes.length === 0 ? (
                    <div className="px-4 py-6 text-scale-sm text-secondary">Loading nodes…</div>
                  ) : backendMountId === null ? (
                    <div className="px-4 py-6 text-scale-sm text-secondary">
                      Select a backend mount to run a search.
                    </div>
                  ) : nodes.length === 0 ? (
                    <div className="px-4 py-6 text-scale-sm text-secondary">No nodes matched the current filters.</div>
                  ) : (
                    <ul className="divide-y divide-subtle">
                      {nodes.map((node) => (
                        <li key={`search-node-${node.id}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedNodeId(node.id)}
                            className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${
                              selectedNodeId === node.id
                                ? 'bg-surface-glass hover:bg-surface-glass-soft'
                                : 'hover:bg-surface-glass-soft'
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="truncate text-scale-sm font-weight-medium text-primary">
                                {node.path}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-weight-semibold uppercase ${STATE_BADGE_CLASS[node.state]}`}>
                                {STATE_LABEL[node.state]}
                              </span>
                            </div>
                            <div className="flex w-full flex-wrap items-center gap-3 text-scale-xs text-muted">
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
                  <div className="flex items-center justify-between border-t border-subtle bg-surface-glass px-4 py-2 text-scale-xs text-muted">
                    <button
                      type="button"
                      onClick={() => handlePaginationChange(Math.max(pagination.offset - LIST_PAGE_SIZE, 0))}
                      disabled={pagination.offset === 0}
                      className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Previous
                    </button>
                    <span className="text-scale-xs text-muted">
                      Page {Math.floor(pagination.offset / LIST_PAGE_SIZE) + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePaginationChange(pagination.nextOffset)}
                      disabled={!pagination.nextOffset && pagination.nextOffset !== 0}
                      className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
              {listErrorMessage ? <p className={STATUS_BANNER_DANGER}>{listErrorMessage}</p> : null}
            </>
          )}
        </section>

        <section
          className={`flex flex-col gap-4 ${PANEL_SURFACE} transition ${
            pendingCommand ? 'pointer-events-none opacity-75' : ''
          }`}
          aria-busy={pendingCommand ? true : undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.25em] text-muted">Node detail</h3>
              <p className="mt-1 text-scale-sm text-secondary">
                Metadata, rollup stats, and subdirectory inspection for the selected node.
              </p>
            </div>
            {selectedNode ? (
              <span className={`rounded-full px-3 py-1 text-[11px] font-weight-semibold uppercase ${STATE_BADGE_CLASS[selectedNode.state]}`}>
                {STATE_LABEL[selectedNode.state]}
              </span>
            ) : null}
          </div>

          {nodeLoading && !selectedNode ? (
            <div className={`${CARD_SURFACE_SOFT} text-scale-sm text-secondary`}>
              Loading node…
            </div>
          ) : !selectedNode ? (
            <div className={`${CARD_SURFACE_SOFT} text-scale-sm text-secondary`}>
              Select a node from the list to view details.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    toggleStar({
                      backendMountId: selectedNode.backendMountId,
                      path: selectedNode.path,
                      kind: selectedNode.kind,
                      displayName: selectedNode.name ?? selectedNode.path.split('/').pop() ?? selectedNode.path
                    })
                  }
                  aria-pressed={selectedNodeStarred}
                  className={
                    selectedNodeStarred
                      ? `${SECONDARY_ACTION_BUTTON} border-accent text-accent`
                      : SECONDARY_ACTION_BUTTON
                  }
                >
                  {selectedNodeStarred ? 'Unstar' : 'Star node'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMoveDialog(true)}
                  disabled={nodeWriteDisabled}
                  className={nodeWriteDisabled ? `${SECONDARY_ACTION_BUTTON} opacity-60` : SECONDARY_ACTION_BUTTON}
                >
                  Move node
                </button>
                <button
                  type="button"
                  onClick={() => setShowCopyDialog(true)}
                  disabled={nodeWriteDisabled}
                  className={nodeWriteDisabled ? `${SECONDARY_ACTION_BUTTON} opacity-60` : SECONDARY_ACTION_BUTTON}
                >
                  Copy node
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={nodeWriteDisabled}
                  className={nodeWriteDisabled ? `${DANGER_ACTION_BUTTON} opacity-60` : DANGER_ACTION_BUTTON}
                >
                  Soft-delete
                </button>
              </div>
              <article className={CARD_SURFACE}>
                <dl className="grid gap-3 text-scale-sm text-secondary">
                  <div>
                    <dt className="text-scale-xs uppercase tracking-wide text-muted">Path</dt>
                    <dd className="mt-1 font-mono text-[13px] text-primary">{selectedNode.path}</dd>
                  </div>
                  {selectedNode.download ? (
                    <div>
                      <dt className="text-scale-xs uppercase tracking-wide text-muted">Download</dt>
                      <dd className="mt-1 flex flex-wrap items-center gap-3 text-secondary">
                        <button
                          type="button"
                          disabled={selectedDownloadState?.state === 'pending'}
                          onClick={() => void handleDownload(selectedNode, 'detail')}
                          className="rounded border border-subtle px-2 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
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
                          <span className="text-scale-xs text-muted">
                            {Math.round(selectedDownloadState.progress * 100)}%
                          </span>
                        ) : null}
                      </dd>
                      {selectedDownloadState?.state === 'error' ? (
                        <dd className="mt-1 text-scale-xs text-status-danger">{selectedDownloadState.error}</dd>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 text-scale-xs md:grid-cols-4 text-secondary">
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Backend</dt>
                      <dd className="mt-1 text-secondary">#{selectedNode.backendMountId}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Kind</dt>
                      <dd className="mt-1 text-secondary">{KIND_LABEL[selectedNode.kind]}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Consistency</dt>
                      <dd className="mt-1 text-secondary">{CONSISTENCY_LABEL[selectedNode.consistencyState] ?? selectedNode.consistencyState}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Version</dt>
                      <dd className="mt-1 text-secondary">{selectedNode.version}</dd>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-scale-xs md:grid-cols-4 text-secondary">
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Last seen</dt>
                      <dd className="mt-1 text-secondary">{formatTimestamp(selectedNode.lastSeenAt)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Last modified</dt>
                      <dd className="mt-1 text-secondary">{formatTimestamp(selectedNode.lastModifiedAt)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Last reconciled</dt>
                      <dd className="mt-1 text-secondary">{formatTimestamp(selectedNode.lastReconciledAt)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-muted">Last drift</dt>
                      <dd className="mt-1 text-secondary">{formatTimestamp(selectedNode.lastDriftDetectedAt)}</dd>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <dt className="text-scale-xs uppercase tracking-wide text-muted">Metadata</dt>
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
                        className={`rounded border border-subtle px-2 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
                      >
                        {metadataEditing ? 'Discard changes' : 'Edit'}
                      </button>
                    </div>
                    <dd className="mt-1 max-h-60 overflow-y-auto rounded border border-subtle bg-surface-glass-soft p-3 text-scale-xs text-secondary">
                      {metadataEditing ? (
                        <div className="flex flex-col gap-3">
                          <textarea
                            value={metadataDraft}
                            onChange={(event) => setMetadataDraft(event.target.value)}
                            rows={8}
                            className={`w-full rounded-lg border border-subtle bg-surface-glass px-3 py-2 font-mono text-scale-xs text-primary shadow-sm transition-colors ${FOCUS_RING}`}
                          />
                          {metadataErrorMessage ? (
                            <p className="text-scale-xs text-status-danger">{metadataErrorMessage}</p>
                          ) : null}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={metadataPending}
                              onClick={() => void handleMetadataSave()}
                              className={PRIMARY_ACTION_BUTTON}
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
                              className={SECONDARY_ACTION_BUTTON}
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
                  <article className={CARD_SURFACE}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">
                        Drift playbook
                      </h4>
                      <span className="text-[11px] font-weight-semibold uppercase text-muted">
                        {STATE_LABEL[playbookContext.node.state]}
                      </span>
                    </div>
                    <p className="text-scale-sm text-secondary">{playbook.summary}</p>
                    <div className="mt-3 space-y-3">
                      {playbook.actions.map((action) => {
                        if (action.type === 'reconcile') {
                          const actionKey = `playbook:${action.id}`;
                          const pending = pendingReconcileActionId === actionKey;
                          return (
                            <div
                              key={action.id}
                              className="rounded-xl border border-subtle bg-surface-glass-soft px-4 py-3 text-scale-sm text-secondary"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="font-medium text-secondary">{action.label}</p>
                                  <p className="mt-1 text-scale-xs text-muted">{action.description}</p>
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
                                  className={`self-start ${PRIMARY_ACTION_BUTTON}`}
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
                              className="rounded-xl border border-subtle bg-surface-glass-soft px-4 py-3 text-scale-sm text-secondary"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="font-medium text-secondary">{action.label}</p>
                                  <p className="mt-1 text-scale-xs text-muted">{action.description}</p>
                                  <p className="mt-1 text-[11px] text-muted">{helperText}</p>
                                </div>
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => void runPlaybookWorkflow(action, playbook.id, selectedNode)}
                                  className={`self-start ${PRIMARY_ACTION_BUTTON}`}
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
                            className="rounded-xl border border-subtle bg-surface-glass-soft px-4 py-3 text-scale-sm text-secondary"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-medium text-secondary">{action.label}</p>
                                <p className="mt-1 text-scale-xs text-muted">{action.description}</p>
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
                                className={`self-start rounded-full border border-subtle px-3 py-1.5 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
                              >
                                Open
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {playbook.note ? (
                      <p className="mt-4 text-[11px] text-muted">{playbook.note}</p>
                    ) : null}
                  </article>
                ) : fallbackPlaybookMessage ? (
                  <article className={CARD_SURFACE}>
                    <h4 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">
                      Drift playbook
                    </h4>
                    <p className="mt-2 text-scale-sm text-secondary">{fallbackPlaybookMessage}</p>
                  </article>
                ) : null
              ) : null}

              <article className={CARD_SURFACE}>
                <h4 className="mb-3 text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">
                  Rollup summary
                </h4>
                {selectedNode.rollup ? (
                  <dl className="grid grid-cols-2 gap-4 text-scale-sm text-secondary md:grid-cols-4">
                    <div>
                      <dt className="text-scale-xs uppercase tracking-wide text-muted">Size</dt>
                      <dd className="mt-1 text-secondary">{formatBytes(selectedNode.rollup.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt className="text-scale-xs uppercase tracking-wide text-muted">Files</dt>
                      <dd className="mt-1 text-secondary">{selectedNode.rollup.fileCount}</dd>
                    </div>
                    <div>
                      <dt className="text-scale-xs uppercase tracking-wide text-muted">Directories</dt>
                      <dd className="mt-1 text-secondary">{selectedNode.rollup.directoryCount}</dd>
                    </div>
                    <div>
                      <dt className="text-scale-xs uppercase tracking-wide text-muted">Children</dt>
                      <dd className="mt-1 text-secondary">{selectedNode.rollup.childCount}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-scale-sm text-secondary">No rollup data available for this node.</p>
                )}
              </article>

              <article className={CARD_SURFACE}>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">Immediate children</h4>
                  <button
                    type="button"
                    onClick={() => void refetchChildren()}
                    className={`rounded border border-subtle px-2 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent ${FOCUS_RING}`}
                  >
                    Refresh
                  </button>
                </div>
                {childrenLoading && !childrenData ? (
                  <p className="text-scale-sm text-secondary">Loading children…</p>
                ) : childrenData && childrenData.children.length > 0 ? (
                  <ul className="divide-y divide-subtle rounded-xl border border-subtle bg-surface-glass-soft">
                    {childrenData.children.map((child) => {
                      const childDownloadState = downloadStatusByNode[child.id];
                      return (
                        <li key={`child-${child.id}`} className="px-3 py-2 text-scale-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-1 items-center gap-2">
                              <span className="truncate text-secondary">{child.path}</span>
                              {child.download ? (
                                <button
                                  type="button"
                                  disabled={childDownloadState?.state === 'pending'}
                                  onClick={() => void handleDownload(child, 'child')}
                                  className={`rounded border border-subtle px-2 py-0.5 text-[11px] font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
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
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-weight-semibold uppercase ${STATE_BADGE_CLASS[child.state]}`}>
                              {STATE_LABEL[child.state]}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-scale-xs text-muted">
                            <span>{KIND_LABEL[child.kind]}</span>
                            <span aria-hidden="true">•</span>
                            <span>{formatBytes(child.rollup?.sizeBytes ?? child.sizeBytes ?? 0)}</span>
                            <span aria-hidden="true">•</span>
                            <span>Seen {formatTimestamp(child.lastSeenAt)}</span>
                          </div>
                          {childDownloadState?.mode === 'stream' &&
                          childDownloadState.state === 'pending' &&
                          typeof childDownloadState.progress === 'number' ? (
                            <div className="mt-1 text-scale-xs text-muted">
                              Progress {Math.round(childDownloadState.progress * 100)}%
                            </div>
                          ) : null}
                          {childDownloadState?.state === 'error' ? (
                            <div className="mt-1 text-scale-xs text-status-danger">{childDownloadState.error}</div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-scale-sm text-secondary">No direct children recorded.</p>
                )}
                {childrenErrorMessage ? (
                  <p className={`mt-2 ${STATUS_BANNER_DANGER}`}>{childrenErrorMessage}</p>
                ) : null}
              </article>

              <article className={CARD_SURFACE}>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">
                    Reconciliation controls
                  </h4>
                  {!hasWriteScope ? (
                    <span className="text-[11px] font-weight-semibold uppercase text-status-warning">Read only</span>
                  ) : null}
                </div>
                <div className="space-y-3 text-scale-xs text-secondary">
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
                  className={`mt-3 w-full ${PRIMARY_ACTION_BUTTON}`}
                >
                  {pendingReconcileActionId !== null ? 'Enqueuing…' : 'Enqueue reconciliation'}
                </button>
              </article>
            </div>
          )}
          {nodeErrorMessage ? <p className={STATUS_BANNER_DANGER}>{nodeErrorMessage}</p> : null}
        </section>

        <div className="flex h-full flex-col gap-4">
          <section className="flex flex-col gap-4 ${PANEL_SURFACE}">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.25em] text-muted">Reconciliation jobs</h3>
                <p className="mt-1 text-scale-sm text-secondary">Monitor queue progress and inspect individual runs.</p>
              </div>
              <span className="text-scale-xs text-muted">Live SSE updates</span>
            </div>
            {!hasWriteScope ? (
              <p className="rounded-lg border border-subtle bg-surface-glass-soft px-3 py-2 text-scale-xs text-secondary">
                Provide a token with the filestore:write scope to review reconciliation jobs.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleApplyJobPath(jobPathDraft);
                  }}
                >
                  <label htmlFor="filestore-job-path" className="text-scale-xs font-weight-medium text-muted">
                    Filter by path prefix
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="filestore-job-path"
                      value={jobPathDraft}
                      onChange={(event) => setJobPathDraft(event.target.value)}
                      placeholder="datasets/observatory"
                      className="flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                    />
                    <button
                      type="submit"
                      className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed"
                    >
                      Apply
                    </button>
                  </div>
                  {jobPathFilter ? (
                    <button
                      type="button"
                      onClick={() => {
                        setJobPathFilter(null);
                        setJobPathDraft('');
                        setJobListOffset(0);
                      }}
                      className="text-scale-xs font-weight-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-accent"
                    >
                      Clear path filter
                    </button>
                  ) : null}
                </form>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-scale-xs font-weight-medium text-muted">Statuses</span>
                    <button
                      type="button"
                      onClick={() => {
                        setJobStatusFilters([]);
                        setJobListOffset(0);
                      }}
                      className="text-scale-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {JOB_STATUS_OPTIONS.map((status) => (
                      <button
                        key={`job-status-${status}`}
                        type="button"
                        onClick={() => handleToggleJobStatus(status)}
                        className={jobStatusFilterSet.has(status) ? FILTER_PILL_ACTIVE : FILTER_PILL_INACTIVE}
                      >
                        {JOB_STATUS_LABEL[status]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-subtle bg-surface-glass-soft">
                  <div className="flex items-center justify-between border-b border-subtle bg-surface-glass px-4 py-3 text-scale-xs font-weight-medium text-muted">
                    <span>Recent jobs</span>
                    <span>
                      {jobListLoading && jobList.length === 0
                        ? 'Loading…'
                        : jobPagination
                          ? `${jobPagination.total} total`
                          : `${jobList.length} loaded`}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {jobListLoading && jobList.length === 0 ? (
                      <div className="px-4 py-6 text-scale-sm text-secondary">Loading reconciliation jobs…</div>
                    ) : jobList.length === 0 ? (
                      <div className="px-4 py-6 text-scale-sm text-secondary">No jobs matched the current filters.</div>
                    ) : (
                      <ul className="divide-y divide-subtle">
                        {jobList.map((job) => {
                          const isSelected = selectedJobId === job.id;
                          const outcome =
                            job.result && typeof job.result === 'object' && 'outcome' in job.result
                              ? String((job.result as Record<string, unknown>).outcome)
                              : null;
                          return (
                            <li key={`job-${job.id}`}>
                              <button
                                type="button"
                                onClick={() => setSelectedJobId(job.id)}
                                className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${
                                  isSelected
                                    ? 'bg-surface-glass hover:bg-surface-glass-soft'
                                    : 'hover:bg-surface-glass-soft'
                                }`}
                              >
                                <div className="flex w-full items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {job.status === 'running' ? (
                                      <span className="h-2 w-2 animate-ping rounded-full bg-status-info" aria-hidden="true" />
                                    ) : null}
                                    <span className="truncate text-scale-sm font-weight-medium text-primary">
                                      {job.path}
                                    </span>
                                  </div>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-weight-semibold uppercase ${JOB_STATUS_BADGE_CLASS[job.status]}`}>
                                    {JOB_STATUS_LABEL[job.status]}
                                  </span>
                                </div>
                                <div className="flex w-full flex-wrap items-center gap-2 text-scale-xs text-muted">
                                  <span>Mount {job.backendMountId}</span>
                                  <span aria-hidden="true">•</span>
                                  <span>{formatTimestamp(job.enqueuedAt)}</span>
                                  <span aria-hidden="true">•</span>
                                  <span>Attempt {job.attempt}</span>
                                  {outcome ? (
                                    <>
                                      <span aria-hidden="true">•</span>
                                      <span>Outcome {outcome}</span>
                                    </>
                                  ) : null}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  {jobPagination ? (
                    <div className="flex items-center justify-between border-t border-subtle bg-surface-glass px-4 py-2 text-scale-xs text-muted">
                      <button
                        type="button"
                        onClick={() => handleJobPaginationChange(Math.max(jobPagination.offset - jobPageSize, 0))}
                        disabled={jobPagination.offset === 0}
                        className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Previous
                      </button>
                      <span className="text-scale-xs text-muted">
                        Page {Math.floor(jobPagination.offset / jobPageSize) + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleJobPaginationChange(jobPagination.nextOffset ?? null)}
                        disabled={jobPagination.nextOffset == null}
                        className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>

                {jobListErrorMessage ? <p className={STATUS_BANNER_DANGER}>{jobListErrorMessage}</p> : null}

                <article className={CARD_SURFACE}>
                  <h4 className="mb-3 text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">
                    Job detail
                  </h4>
                  {jobDetailLoading && selectedJobId !== null ? (
                    <p className="text-scale-sm text-secondary">Loading job details…</p>
                  ) : jobDetailErrorMessage ? (
                    <p className={STATUS_BANNER_DANGER}>{jobDetailErrorMessage}</p>
                  ) : !selectedJob ? (
                    <p className="text-scale-sm text-secondary">Select a reconciliation job to inspect details.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-scale-sm font-weight-medium text-secondary">{selectedJob.path}</p>
                          <p className="text-scale-xs text-muted">
                            Mount {selectedJob.backendMountId} · Reason {selectedJob.reason}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase ${JOB_STATUS_BADGE_CLASS[selectedJob.status]}`}>
                          {JOB_STATUS_LABEL[selectedJob.status]}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-scale-xs text-muted">
                        <div>
                          <dt className="uppercase tracking-wide text-[10px]">Node</dt>
                          <dd className="mt-1 text-secondary">{selectedJob.nodeId ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-[10px]">Attempt</dt>
                          <dd className="mt-1 text-secondary">{selectedJob.attempt}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-[10px]">Enqueued</dt>
                          <dd className="mt-1 text-secondary">{formatTimestamp(selectedJob.enqueuedAt)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-[10px]">Started</dt>
                          <dd className="mt-1 text-secondary">{formatTimestamp(selectedJob.startedAt)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-[10px]">Completed</dt>
                          <dd className="mt-1 text-secondary">{formatTimestamp(selectedJob.completedAt)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-[10px]">Duration</dt>
                          <dd className="mt-1 text-secondary">{formatDurationMs(selectedJob.durationMs)}</dd>
                        </div>
                      </dl>
                      {selectedJob.result &&
                      typeof selectedJob.result === 'object' &&
                      'outcome' in selectedJob.result &&
                      (selectedJob.result as Record<string, unknown>).outcome ? (
                        <p className="text-scale-xs text-muted">
                          Outcome {(selectedJob.result as Record<string, unknown>).outcome as string}
                        </p>
                      ) : null}
                      {selectedJob.error && typeof selectedJob.error === 'object' ? (
                        <div className={`${STATUS_BANNER_DANGER} space-y-1`}>
                          <p className="font-weight-semibold">
                            {String((selectedJob.error as Record<string, unknown>).message ?? 'Reconciliation failed')}
                          </p>
                          <p>
                            Review reconciliation worker logs or retry the job after addressing the underlying issue.
                          </p>
                        </div>
                      ) : null}
                      {selectedJob.status === 'running' ? (
                        <p className="text-scale-xs text-muted">Job is currently running. Updates will appear automatically.</p>
                      ) : null}
                    </div>
                  )}
                </article>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4 ${PANEL_SURFACE}">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.25em] text-muted">Activity feed</h3>
              <span className="text-scale-xs text-muted">
                {sseActive ? 'Scoped SSE updates' : 'Polling updates'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {EVENT_CATEGORY_ORDER.map((category) => {
                const enabled = eventCategoryFilters[category];
                const definition = EVENT_CATEGORY_DEFINITIONS[category];
                return (
                  <button
                    key={`event-category-${category}`}
                    type="button"
                    aria-pressed={enabled}
                    title={definition.description}
                    onClick={() => toggleEventCategory(category)}
                    className={enabled ? FILTER_PILL_ACTIVE : FILTER_PILL_INACTIVE}
                  >
                    {definition.label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto rounded-2xl border border-subtle bg-surface-glass-soft">
              {enabledEventTypes.length === 0 ? (
                <div className="px-4 py-6 text-scale-sm text-secondary">
                  Enable at least one event category to receive live updates.
                </div>
              ) : visibleActivity.length === 0 ? (
                <div className="px-4 py-6 text-scale-sm text-secondary">Awaiting incoming events…</div>
              ) : (
                <ul className="divide-y divide-subtle">
                  {visibleActivity.map((entry) => (
                    <li key={entry.id} className="px-4 py-3 text-scale-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-secondary">{entry.label}</span>
                        <span className="text-[11px] text-muted">Mount {entry.backendMountId ?? '–'}</span>
                      </div>
                      <p className="mt-1 text-scale-xs text-muted">{entry.detail}</p>
                      <p className="mt-1 text-[11px] text-muted">{formatTimestamp(entry.timestamp)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <CreateDirectoryDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        basePath={defaultDirectoryBasePath ?? null}
        disabled={pendingCommand !== null}
        onSubmit={handleCreateDirectoryCommand}
      />
      <UploadFileDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        basePath={uploadBasePath ?? null}
        disabled={pendingCommand !== null}
        onSubmit={handleUploadFileCommand}
      />
      <MoveCopyDialog
        mode="move"
        open={showMoveDialog}
        onClose={() => setShowMoveDialog(false)}
        sourcePath={moveCopySourcePath}
        sourceMountId={selectedNodeMountId}
        availableMounts={availableMounts}
        disabled={pendingCommand !== null}
        onSubmit={handleMoveNodeCommand}
      />
      <MoveCopyDialog
        mode="copy"
        open={showCopyDialog}
        onClose={() => setShowCopyDialog(false)}
        sourcePath={moveCopySourcePath}
        sourceMountId={selectedNodeMountId}
        availableMounts={availableMounts}
        disabled={pendingCommand !== null}
        onSubmit={handleCopyNodeCommand}
      />
      <DeleteNodeDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        path={selectedNodePath}
        disabled={pendingCommand !== null}
        onSubmit={handleDeleteNodeCommand}
      />
    </div>
  );
}
