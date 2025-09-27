import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilestoreExplorerPage from '../FilestoreExplorerPage';
import type { FilestoreBackendMount, FilestoreNode } from '../types';
import type { WorkflowDefinition, WorkflowRun } from '../../workflows/types';
import type { AuthIdentity } from '../../auth/context';
import type {
  UsePollingResourceOptions,
  UsePollingResourceResult
} from '../../hooks/usePollingResource';

type ListBackendMountsMock = (...args: any[]) => Promise<{ mounts: FilestoreBackendMount[] }>;
type PollingResourceFn = (options: UsePollingResourceOptions<unknown>) => UsePollingResourceResult<unknown>;

const listBackendMountsMock = vi.fn<ListBackendMountsMock>();
const subscribeToFilestoreEventsMock = vi.fn((..._args: any[]) => ({ close: vi.fn() }));
const trackEventMock = vi.fn();
const pollingResourceMock = vi.fn<PollingResourceFn>(() => ({
  data: null,
  error: null,
  loading: false,
  lastUpdatedAt: null,
  refetch: vi.fn(async () => {}),
  stop: vi.fn()
}));
const authorizedFetchMock = vi.fn();
const enqueueReconciliationMock = vi.fn();
const listWorkflowDefinitionsMock = vi.fn();
const triggerWorkflowRunMock = vi.fn();
const sampleMount: FilestoreBackendMount = {
  id: 2,
  mountKey: 'primary',
  backendKind: 'local',
  accessMode: 'rw',
  state: 'active',
  rootPath: '/mnt/primary',
  bucket: null,
  prefix: null
};
const writableIdentity: AuthIdentity = {
  subject: 'tester',
  kind: 'user',
  scopes: ['filestore:write'],
  authDisabled: false,
  userId: 'tester',
  sessionId: 'session',
  apiKeyId: null,
  displayName: 'Tester',
  email: 'tester@example.com',
  roles: []
};

function buildNode(overrides: Partial<FilestoreNode> = {}): FilestoreNode {
  return {
    id: 42,
    backendMountId: sampleMount.id,
    parentId: null,
    path: 'datasets/example',
    name: 'example',
    depth: 1,
    kind: 'directory',
    sizeBytes: 0,
    checksum: null,
    contentHash: null,
    metadata: {},
    state: 'inconsistent',
    version: 1,
    isSymlink: false,
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    lastModifiedAt: null,
    consistencyState: 'inconsistent',
    consistencyCheckedAt: '2024-01-01T00:00:00.000Z',
    lastReconciledAt: null,
    lastDriftDetectedAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    rollup: null,
    ...overrides
  } satisfies FilestoreNode;
}

function setupPollingResourcesForNode(node: FilestoreNode) {
  const listResource: UsePollingResourceResult<unknown> = {
    data: {
      nodes: [node],
      pagination: { total: 1, limit: 25, offset: 0, nextOffset: null },
      filters: {
        backendMountId: node.backendMountId,
        path: null,
        depth: null,
        states: [],
        kinds: [],
        search: null,
        driftOnly: false
      }
    },
    error: null,
    loading: false,
    lastUpdatedAt: null,
    refetch: vi.fn(async () => {}),
    stop: vi.fn()
  };
  const nodeResource: UsePollingResourceResult<FilestoreNode> = {
    data: node,
    error: null,
    loading: false,
    lastUpdatedAt: null,
    refetch: vi.fn(async () => {}),
    stop: vi.fn()
  };
  const childrenResource: UsePollingResourceResult<unknown> = {
    data: {
      parent: node,
      children: [],
      pagination: { total: 0, limit: 50, offset: 0, nextOffset: null },
      filters: {
        states: [],
        kinds: [],
        search: null,
        driftOnly: false
      }
    },
    error: null,
    loading: false,
    lastUpdatedAt: null,
    refetch: vi.fn(async () => {}),
    stop: vi.fn()
  };
  let callIndex = 0;
  pollingResourceMock.mockImplementation(() => {
    const resources = [listResource, nodeResource, childrenResource];
    const resource = resources[callIndex % resources.length];
    callIndex += 1;
    return resource;
  });
}
const toastHelpersMock = {
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
  showToast: vi.fn(),
  showDestructiveSuccess: vi.fn(),
  showDestructiveError: vi.fn()
};

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../hooks/usePollingResource', () => ({
  usePollingResource: pollingResourceMock
}));

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

vi.mock('../api', () => ({
  __esModule: true,
  enqueueReconciliation: (...args: unknown[]) => enqueueReconciliationMock(...args),
  fetchNodeById: vi.fn(),
  fetchNodeChildren: vi.fn(),
  listBackendMounts: (...args: unknown[]) => listBackendMountsMock(...args),
  listNodes: vi.fn(),
  subscribeToFilestoreEvents: (...args: unknown[]) => subscribeToFilestoreEventsMock(...args),
  updateNodeMetadata: vi.fn()
}));

vi.mock('../../workflows/api', () => ({
  listWorkflowDefinitions: (...args: unknown[]) => listWorkflowDefinitionsMock(...args)
}));

vi.mock('../../dataAssets/api', () => ({
  triggerWorkflowRun: (...args: unknown[]) => triggerWorkflowRunMock(...args)
}));

vi.mock('../../utils/useAnalytics', () => ({
  useAnalytics: () => ({
    trackEvent: (...args: unknown[]) => trackEventMock(...args)
  })
}));

describe('FilestoreExplorerPage mount discovery', () => {
  beforeEach(() => {
    localStorage.clear();
    listBackendMountsMock.mockReset();
    listBackendMountsMock.mockResolvedValue({ mounts: [] });
    enqueueReconciliationMock.mockReset();
    enqueueReconciliationMock.mockResolvedValue(undefined);
    listWorkflowDefinitionsMock.mockReset();
    listWorkflowDefinitionsMock.mockResolvedValue([]);
    triggerWorkflowRunMock.mockReset();
    triggerWorkflowRunMock.mockResolvedValue({ id: 'run-123' });
    trackEventMock.mockClear();
    subscribeToFilestoreEventsMock.mockClear();
    pollingResourceMock.mockClear();
    authorizedFetchMock.mockClear();
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
  });

  it('loads backend mounts and persists selection changes', async () => {
    listBackendMountsMock.mockResolvedValueOnce({
      mounts: [
        {
          id: 2,
          mountKey: 'primary',
          backendKind: 'local',
          accessMode: 'rw',
          state: 'active',
          rootPath: '/mnt/primary',
          bucket: null,
          prefix: null
        },
        {
          id: 5,
          mountKey: 'archive',
          backendKind: 's3',
          accessMode: 'ro',
          state: 'active',
          rootPath: null,
          bucket: 'archive-bucket',
          prefix: 'datasets/'
        }
      ]
    });

    render(<FilestoreExplorerPage identity={null} />);

    const select = await screen.findByLabelText('Known mounts');
    await waitFor(() => {
      expect(select).toHaveValue('2');
    });
    await waitFor(() => {
      expect(localStorage.getItem('apphub.filestore.selectedMountId')).toBe('2');
    });

    fireEvent.change(select, { target: { value: '5' } });

    await waitFor(() => {
      expect(trackEventMock).toHaveBeenCalledWith('filestore.mount.changed', {
        backendMountId: 5,
        source: 'select'
      });
    });
    expect(localStorage.getItem('apphub.filestore.selectedMountId')).toBe('5');
  });

  it('restores the stored mount when still available', async () => {
    localStorage.setItem('apphub.filestore.selectedMountId', '5');
    listBackendMountsMock.mockResolvedValueOnce({
      mounts: [
        {
          id: 3,
          mountKey: 'analytics',
          backendKind: 'local',
          accessMode: 'rw',
          state: 'active',
          rootPath: '/mnt/analytics',
          bucket: null,
          prefix: null
        },
        {
          id: 5,
          mountKey: 'archive',
          backendKind: 's3',
          accessMode: 'ro',
          state: 'active',
          rootPath: null,
          bucket: 'archive-bucket',
          prefix: 'datasets/'
        }
      ]
    });

    render(<FilestoreExplorerPage identity={null} />);

    const select = await screen.findByLabelText('Known mounts');
    await waitFor(() => {
      expect(select).toHaveValue('5');
    });
    await waitFor(() => {
      expect(localStorage.getItem('apphub.filestore.selectedMountId')).toBe('5');
    });
  });

  it('shows an empty state when no mounts are returned', async () => {
    listBackendMountsMock.mockResolvedValueOnce({ mounts: [] });

    render(<FilestoreExplorerPage identity={null} />);

    await waitFor(() => {
      expect(screen.getByText('No backend mounts detected.')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Known mounts')).not.toBeInTheDocument();
  });
});

describe('FilestoreExplorerPage playbooks', () => {
  beforeEach(() => {
    localStorage.clear();
    listBackendMountsMock.mockReset();
    listBackendMountsMock.mockResolvedValue({ mounts: [sampleMount] });
    enqueueReconciliationMock.mockReset();
    enqueueReconciliationMock.mockResolvedValue(undefined);
    listWorkflowDefinitionsMock.mockReset();
    listWorkflowDefinitionsMock.mockResolvedValue([]);
    triggerWorkflowRunMock.mockReset();
    triggerWorkflowRunMock.mockResolvedValue({ id: 'run-123' } as WorkflowRun);
    trackEventMock.mockClear();
    subscribeToFilestoreEventsMock.mockClear();
    authorizedFetchMock.mockClear();
    pollingResourceMock.mockReset();
    pollingResourceMock.mockImplementation(() => ({
      data: null,
      error: null,
      loading: false,
      lastUpdatedAt: null,
      refetch: vi.fn(async () => {}),
      stop: vi.fn()
    }));
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
  });

  it('surfaces playbook actions for inconsistent nodes', async () => {
    const node = buildNode({ state: 'inconsistent' });
    setupPollingResourcesForNode(node);
    listWorkflowDefinitionsMock.mockResolvedValueOnce([
      {
        id: 'wf-drift',
        slug: 'filestore-drift-audit',
        name: 'Filestore Drift Audit'
      } as WorkflowDefinition
    ]);

    render(<FilestoreExplorerPage identity={writableIdentity} />);

    await screen.findByText('Drift playbook');

    const enqueueButton = await screen.findByRole('button', { name: 'Enqueue job' });
    fireEvent.click(enqueueButton);

    await waitFor(() => expect(enqueueReconciliationMock).toHaveBeenCalled());
    const reconcileArgs = enqueueReconciliationMock.mock.calls[0][1] as Record<string, unknown>;
    expect(reconcileArgs).toMatchObject({
      backendMountId: node.backendMountId,
      path: node.path,
      nodeId: node.id,
      reason: 'drift',
      requestedHash: true
    });

    const workflowButton = await screen.findByRole('button', { name: 'Trigger workflow' });
    fireEvent.click(workflowButton);

    await waitFor(() => expect(triggerWorkflowRunMock).toHaveBeenCalled());
    const workflowCall = triggerWorkflowRunMock.mock.calls[0];
    expect(workflowCall[1]).toBe('filestore-drift-audit');
    expect(workflowCall[2]).toMatchObject({
      triggeredBy: 'filestore-playbook',
      parameters: {
        backendMountId: node.backendMountId,
        path: node.path
      }
    });
  });

  it('disables workflow action when remediation workflow is missing', async () => {
    const node = buildNode({ state: 'missing' });
    setupPollingResourcesForNode(node);

    render(<FilestoreExplorerPage identity={writableIdentity} />);

    await screen.findByText('Drift playbook');
    await waitFor(() => expect(listWorkflowDefinitionsMock).toHaveBeenCalled());

    const workflowButton = await screen.findByRole('button', { name: 'Trigger workflow' });
    expect(workflowButton).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/filestore-restore-missing-node workflow/i)).toBeInTheDocument());
  });
});
