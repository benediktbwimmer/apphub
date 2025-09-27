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

const mocks = vi.hoisted(() => {
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
  const presignNodeDownloadMock = vi.fn();

  return {
    listBackendMountsMock,
    subscribeToFilestoreEventsMock,
    trackEventMock,
    pollingResourceMock,
    authorizedFetchMock,
    enqueueReconciliationMock,
    listWorkflowDefinitionsMock,
    triggerWorkflowRunMock,
    presignNodeDownloadMock
  };
});
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
    download: null,
    ...overrides
  } satisfies FilestoreNode;
}

function setupPollingResourcesForNode(node: FilestoreNode) {
  const { pollingResourceMock } = mocks;
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
  useAuthorizedFetch: () => mocks.authorizedFetchMock
}));

vi.mock('../../hooks/usePollingResource', () => ({
  usePollingResource: mocks.pollingResourceMock
}));

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

vi.mock('../api', () => ({
  __esModule: true,
  enqueueReconciliation: (...args: unknown[]) => mocks.enqueueReconciliationMock(...args),
  fetchNodeById: vi.fn(),
  fetchNodeChildren: vi.fn(),
  listBackendMounts: (...args: unknown[]) => mocks.listBackendMountsMock(...args),
  listNodes: vi.fn(),
  presignNodeDownload: (...args: unknown[]) => mocks.presignNodeDownloadMock(...args),
  subscribeToFilestoreEvents: (...args: unknown[]) => mocks.subscribeToFilestoreEventsMock(...args),
  updateNodeMetadata: vi.fn()
}));

vi.mock('../../workflows/api', () => ({
  listWorkflowDefinitions: (...args: unknown[]) => mocks.listWorkflowDefinitionsMock(...args)
}));

vi.mock('../../dataAssets/api', () => ({
  triggerWorkflowRun: (...args: unknown[]) => mocks.triggerWorkflowRunMock(...args)
}));

vi.mock('../../utils/useAnalytics', () => ({
  useAnalytics: () => ({
    trackEvent: (...args: unknown[]) => mocks.trackEventMock(...args)
  })
}));

describe('FilestoreExplorerPage mount discovery', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listBackendMountsMock.mockReset();
    mocks.listBackendMountsMock.mockResolvedValue({ mounts: [] });
    mocks.enqueueReconciliationMock.mockReset();
    mocks.enqueueReconciliationMock.mockResolvedValue(undefined);
    mocks.listWorkflowDefinitionsMock.mockReset();
    mocks.listWorkflowDefinitionsMock.mockResolvedValue([]);
    mocks.triggerWorkflowRunMock.mockReset();
    mocks.triggerWorkflowRunMock.mockResolvedValue({ id: 'run-123' });
    mocks.trackEventMock.mockClear();
    mocks.subscribeToFilestoreEventsMock.mockClear();
    mocks.pollingResourceMock.mockClear();
    mocks.authorizedFetchMock.mockReset();
    mocks.presignNodeDownloadMock.mockReset();
    (URL as unknown as { createObjectURL: ReturnType<typeof vi.fn> }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL = vi.fn();
    window.open = vi.fn();
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
  });

  it('loads backend mounts and persists selection changes', async () => {
    mocks.listBackendMountsMock.mockResolvedValueOnce({
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
      expect(mocks.trackEventMock).toHaveBeenCalledWith('filestore.mount.changed', {
        backendMountId: 5,
        source: 'select'
      });
    });
    expect(localStorage.getItem('apphub.filestore.selectedMountId')).toBe('5');
  });

  it('restores the stored mount when still available', async () => {
    localStorage.setItem('apphub.filestore.selectedMountId', '5');
    mocks.listBackendMountsMock.mockResolvedValueOnce({
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
    mocks.listBackendMountsMock.mockResolvedValueOnce({ mounts: [] });

    render(<FilestoreExplorerPage identity={null} />);

    await waitFor(() => {
      expect(screen.getByText('No backend mounts detected.')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Known mounts')).not.toBeInTheDocument();
  });

  it('streams file downloads via inline endpoint', async () => {
    const fileNode = buildNode({
      kind: 'file',
      download: {
        mode: 'stream',
        streamUrl: '/v1/files/42/content',
        presignUrl: null,
        supportsRange: true,
        sizeBytes: 9,
        checksum: null,
        contentHash: null,
        filename: 'example.csv'
      }
    });
    setupPollingResourcesForNode(fileNode);
    mocks.listBackendMountsMock.mockResolvedValueOnce({ mounts: [sampleMount] });

    const chunk = new TextEncoder().encode('download');
    const reader = {
      read: vi
        .fn<[], Promise<{ value: Uint8Array | undefined; done: boolean }>>()
        .mockResolvedValueOnce({ value: chunk, done: false })
        .mockResolvedValueOnce({ value: undefined, done: true })
    };
    const headers = {
      get: (name: string) => {
        const map: Record<string, string> = {
          'content-type': 'text/plain',
          'content-length': String(chunk.length)
        };
        return map[name.toLowerCase()] ?? null;
      }
    };
    mocks.authorizedFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers,
      body: {
        getReader: () => reader
      },
      arrayBuffer: async () => chunk.buffer
    } as unknown as Response);

    render(<FilestoreExplorerPage identity={null} />);

    const downloadButton = await screen.findByRole('button', { name: 'Download file' });
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(mocks.authorizedFetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/files/42/content'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    await waitFor(() => {
      expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Download complete');
    });
    expect((URL.createObjectURL as unknown as vi.Mock)).toHaveBeenCalledTimes(1);
  });

  it('opens presigned download links when provided', async () => {
    const fileNode = buildNode({
      kind: 'file',
      download: {
        mode: 'presign',
        streamUrl: '/v1/files/42/content',
        presignUrl: '/v1/files/42/presign',
        supportsRange: true,
        sizeBytes: 0,
        checksum: null,
        contentHash: null,
        filename: 'example.csv'
      }
    });
    setupPollingResourcesForNode(fileNode);
    mocks.listBackendMountsMock.mockResolvedValueOnce({ mounts: [sampleMount] });

    mocks.presignNodeDownloadMock.mockResolvedValueOnce({
      url: 'https://example.com/download',
      expiresAt: new Date().toISOString(),
      headers: {},
      method: 'GET'
    });

    render(<FilestoreExplorerPage identity={null} />);

    const downloadButton = await screen.findByRole('button', { name: 'Open download link' });
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(mocks.presignNodeDownloadMock).toHaveBeenCalled();
    });
    expect(window.open).toHaveBeenCalledWith('https://example.com/download', '_blank', 'noopener,noreferrer');
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Presigned link opened');
  });
});

describe('FilestoreExplorerPage playbooks', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listBackendMountsMock.mockReset();
    mocks.listBackendMountsMock.mockResolvedValue({ mounts: [sampleMount] });
    mocks.enqueueReconciliationMock.mockReset();
    mocks.enqueueReconciliationMock.mockResolvedValue(undefined);
    mocks.listWorkflowDefinitionsMock.mockReset();
    mocks.listWorkflowDefinitionsMock.mockResolvedValue([]);
    mocks.triggerWorkflowRunMock.mockReset();
    mocks.triggerWorkflowRunMock.mockResolvedValue({ id: 'run-123' } as WorkflowRun);
    mocks.trackEventMock.mockClear();
    mocks.subscribeToFilestoreEventsMock.mockClear();
    mocks.authorizedFetchMock.mockReset();
    mocks.presignNodeDownloadMock.mockReset();
    (URL as unknown as { createObjectURL: ReturnType<typeof vi.fn> }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL = vi.fn();
    window.open = vi.fn();
    mocks.pollingResourceMock.mockReset();
    mocks.pollingResourceMock.mockImplementation(() => ({
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
    mocks.listWorkflowDefinitionsMock.mockResolvedValueOnce([
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

    await waitFor(() => expect(mocks.enqueueReconciliationMock).toHaveBeenCalled());
    const reconcileArgs = mocks.enqueueReconciliationMock.mock.calls[0][1] as Record<string, unknown>;
    expect(reconcileArgs).toMatchObject({
      backendMountId: node.backendMountId,
      path: node.path,
      nodeId: node.id,
      reason: 'drift',
      requestedHash: true
    });

    const workflowButton = await screen.findByRole('button', { name: 'Trigger workflow' });
    fireEvent.click(workflowButton);

    await waitFor(() => expect(mocks.triggerWorkflowRunMock).toHaveBeenCalled());
    const workflowCall = mocks.triggerWorkflowRunMock.mock.calls[0];
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
    await waitFor(() => expect(mocks.listWorkflowDefinitionsMock).toHaveBeenCalled());

    const workflowButton = await screen.findByRole('button', { name: 'Trigger workflow' });
    expect(workflowButton).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/filestore-restore-missing-node workflow/i)).toBeInTheDocument());
  });
});
