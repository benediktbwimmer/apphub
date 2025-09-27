import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FilestoreExplorerPage from '../FilestoreExplorerPage';
import type { FilestoreBackendMount, FilestoreBackendMountList, FilestoreNode } from '../types';
import type { WorkflowDefinition, WorkflowRun } from '../../workflows/types';
import type { AuthIdentity } from '../../auth/context';
import type {
  UsePollingResourceOptions,
  UsePollingResourceResult
} from '../../hooks/usePollingResource';

const iso = '2024-01-01T00:00:00.000Z';

type ListBackendMountsMock = (...args: any[]) => Promise<FilestoreBackendMountList>;
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
  const listReconciliationJobsMock = vi.fn();
  const fetchReconciliationJobMock = vi.fn();
  const createDirectoryMock = vi.fn();
  const uploadFileMock = vi.fn();
  const moveNodeMock = vi.fn();
  const copyNodeMock = vi.fn();
  const deleteNodeMock = vi.fn();
  const fetchNodeByPathMock = vi.fn();

  return {
    listBackendMountsMock,
    subscribeToFilestoreEventsMock,
    trackEventMock,
    pollingResourceMock,
    authorizedFetchMock,
    enqueueReconciliationMock,
    listWorkflowDefinitionsMock,
    triggerWorkflowRunMock,
    presignNodeDownloadMock,
    listReconciliationJobsMock,
    fetchReconciliationJobMock,
    createDirectoryMock,
    uploadFileMock,
    moveNodeMock,
    copyNodeMock,
    deleteNodeMock,
    fetchNodeByPathMock
  };
});
const sampleMount: FilestoreBackendMount = {
  id: 2,
  mountKey: 'primary',
  backendKind: 'local',
  accessMode: 'rw',
  state: 'active',
  displayName: 'Primary mount',
  description: 'Primary data root',
  contact: null,
  labels: ['core'],
  stateReason: null,
  rootPath: '/mnt/primary',
  bucket: null,
  prefix: null,
  lastHealthCheckAt: null,
  lastHealthStatus: null,
  createdAt: iso,
  updatedAt: iso
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

function buildMountList(mounts: FilestoreBackendMount[]): FilestoreBackendMountList {
  return {
    mounts,
    pagination: {
      total: mounts.length,
      limit: 25,
      offset: 0,
      nextOffset: null
    },
    filters: {
      search: null,
      kinds: [],
      states: [],
      accessModes: []
    }
  };
}

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
    lastSeenAt: iso,
    lastModifiedAt: null,
    consistencyState: 'inconsistent',
    consistencyCheckedAt: iso,
    lastReconciledAt: null,
    lastDriftDetectedAt: iso,
    createdAt: iso,
    updatedAt: iso,
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
  const sampleJob = {
    id: 100,
    jobKey: `reconcile:${node.backendMountId}:${node.path}`,
    backendMountId: node.backendMountId,
    nodeId: node.id,
    path: node.path,
    reason: 'manual' as const,
    status: 'succeeded' as const,
    detectChildren: false,
    requestedHash: false,
    attempt: 1,
    result: { outcome: 'reconciled' },
    error: null,
    enqueuedAt: '2024-01-01T00:00:00.000Z',
    startedAt: '2024-01-01T00:00:01.000Z',
    completedAt: '2024-01-01T00:00:02.000Z',
    durationMs: 2000,
    updatedAt: '2024-01-01T00:00:02.000Z'
  };
  const jobsResource: UsePollingResourceResult<unknown> = {
    data: {
      jobs: [sampleJob],
      pagination: { total: 1, limit: 20, offset: 0, nextOffset: null },
      filters: { backendMountId: node.backendMountId, path: null, status: [] }
    },
    error: null,
    loading: false,
    lastUpdatedAt: null,
    refetch: vi.fn(async () => {}),
    stop: vi.fn()
  };
  const jobDetailResource: UsePollingResourceResult<unknown> = {
    data: sampleJob,
    error: null,
    loading: false,
    lastUpdatedAt: null,
    refetch: vi.fn(async () => {}),
    stop: vi.fn()
  };
  let callIndex = 0;
  pollingResourceMock.mockImplementation(() => {
    const resources = [listResource, nodeResource, childrenResource, jobsResource, jobDetailResource];
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
  fetchReconciliationJob: (...args: unknown[]) => mocks.fetchReconciliationJobMock(...args),
  fetchNodeByPath: (...args: unknown[]) => mocks.fetchNodeByPathMock(...args),
  listBackendMounts: (...args: unknown[]) => mocks.listBackendMountsMock(...args),
  listNodes: vi.fn(),
  listReconciliationJobs: (...args: unknown[]) => mocks.listReconciliationJobsMock(...args),
  createDirectory: (...args: unknown[]) => mocks.createDirectoryMock(...args),
  uploadFile: (...args: unknown[]) => mocks.uploadFileMock(...args),
  moveNode: (...args: unknown[]) => mocks.moveNodeMock(...args),
  copyNode: (...args: unknown[]) => mocks.copyNodeMock(...args),
  deleteNode: (...args: unknown[]) => mocks.deleteNodeMock(...args),
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
    mocks.listBackendMountsMock.mockResolvedValue(buildMountList([]));
    mocks.enqueueReconciliationMock.mockReset();
    mocks.enqueueReconciliationMock.mockResolvedValue(undefined);
    mocks.listWorkflowDefinitionsMock.mockReset();
    mocks.listWorkflowDefinitionsMock.mockResolvedValue([]);
    mocks.triggerWorkflowRunMock.mockReset();
    mocks.triggerWorkflowRunMock.mockResolvedValue({ id: 'run-123' });
    mocks.listReconciliationJobsMock.mockReset();
    mocks.listReconciliationJobsMock.mockResolvedValue({
      jobs: [],
      pagination: { total: 0, limit: 20, offset: 0, nextOffset: null },
      filters: { backendMountId: null, path: null, status: [] }
    });
    mocks.fetchReconciliationJobMock.mockReset();
    mocks.fetchReconciliationJobMock.mockResolvedValue(null);
    mocks.trackEventMock.mockClear();
    mocks.subscribeToFilestoreEventsMock.mockClear();
    mocks.pollingResourceMock.mockReset();
    mocks.pollingResourceMock.mockImplementation(() => ({
      data: null,
      error: null,
      loading: false,
      lastUpdatedAt: null,
      refetch: vi.fn(async () => {}),
      stop: vi.fn()
    }));
    mocks.authorizedFetchMock.mockReset();
    mocks.presignNodeDownloadMock.mockReset();
    mocks.createDirectoryMock.mockReset();
    mocks.createDirectoryMock.mockResolvedValue({ idempotent: false, journalEntryId: 1, node: null, result: {} });
    mocks.uploadFileMock.mockReset();
    mocks.uploadFileMock.mockResolvedValue({ idempotent: false, journalEntryId: 2, node: null, result: {} });
    mocks.moveNodeMock.mockReset();
    mocks.moveNodeMock.mockResolvedValue({ idempotent: false, journalEntryId: 3, node: null, result: {} });
    mocks.copyNodeMock.mockReset();
    mocks.copyNodeMock.mockResolvedValue({ idempotent: false, journalEntryId: 4, node: null, result: {} });
    mocks.deleteNodeMock.mockReset();
    mocks.deleteNodeMock.mockResolvedValue({ idempotent: false, journalEntryId: 5, node: null, result: {} });
    let nextFetchId = 1000;
    mocks.fetchNodeByPathMock.mockReset();
    mocks.fetchNodeByPathMock.mockImplementation(async (_fetch, params) =>
      buildNode({ id: nextFetchId++, path: params.path, backendMountId: params.backendMountId })
    );
    (URL as unknown as { createObjectURL: ReturnType<typeof vi.fn> }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL = vi.fn();
    window.open = vi.fn();
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
  });

  it('loads backend mounts and persists selection changes', async () => {
    mocks.listBackendMountsMock.mockResolvedValueOnce(
      buildMountList([
        sampleMount,
        {
          id: 5,
          mountKey: 'archive',
          backendKind: 's3',
          accessMode: 'ro',
          state: 'inactive',
          displayName: 'Archive bucket',
          description: null,
          contact: null,
          labels: ['archive'],
          stateReason: 'paused',
          rootPath: null,
          bucket: 'archive-bucket',
          prefix: 'datasets/',
          lastHealthCheckAt: null,
          lastHealthStatus: null,
          createdAt: iso,
          updatedAt: iso
        }
      ])
    );

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
    mocks.listBackendMountsMock.mockResolvedValueOnce(
      buildMountList([
        {
          id: 3,
          mountKey: 'analytics',
          backendKind: 'local',
          accessMode: 'rw',
          state: 'active',
          displayName: 'Analytics',
          description: null,
          contact: null,
          labels: ['analytics'],
          stateReason: null,
          rootPath: '/mnt/analytics',
          bucket: null,
          prefix: null,
          lastHealthCheckAt: iso,
          lastHealthStatus: 'ok',
          createdAt: iso,
          updatedAt: iso
        },
        {
          id: 5,
          mountKey: 'archive',
          backendKind: 's3',
          accessMode: 'ro',
          state: 'active',
          displayName: 'Archive bucket',
          description: null,
          contact: null,
          labels: ['archive'],
          stateReason: null,
          rootPath: null,
          bucket: 'archive-bucket',
          prefix: 'datasets/',
          lastHealthCheckAt: null,
          lastHealthStatus: null,
          createdAt: iso,
          updatedAt: iso
        }
      ])
    );

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
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([]));

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
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([sampleMount]));

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
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([sampleMount]));

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

  it('renders reconciliation job history when mounts and write scope are available', async () => {
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([sampleMount]));
    setupPollingResourcesForNode(buildNode());

    render(<FilestoreExplorerPage identity={writableIdentity} />);

    await waitFor(() => expect(screen.getByText('Reconciliation jobs')).toBeInTheDocument());
    expect(screen.getAllByText('datasets/example').length).toBeGreaterThan(0);
    expect(screen.getByText('Job detail')).toBeInTheDocument();
  });

  it('creates directories via the dialog and calls the API', async () => {
    const node = buildNode();
    setupPollingResourcesForNode(node);
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([sampleMount]));
    const createdNode = buildNode({ id: 99, path: 'datasets/new-dir', backendMountId: sampleMount.id });
    mocks.createDirectoryMock.mockResolvedValueOnce({
      idempotent: false,
      journalEntryId: 11,
      node: createdNode,
      result: { path: createdNode.path }
    });

    render(<FilestoreExplorerPage identity={writableIdentity} />);

    const createButton = await screen.findByRole('button', { name: 'New directory' });
    fireEvent.click(createButton);

    const pathInput = await screen.findByLabelText('Directory path');
    fireEvent.change(pathInput, { target: { value: 'datasets/new-dir' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create directory' }));

    await waitFor(() => {
      expect(mocks.createDirectoryMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = mocks.createDirectoryMock.mock.calls[0];
    expect((payload as { path: string }).path).toBe('datasets/new-dir');
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Directory creation requested');
    await waitFor(() => {
      expect(screen.queryByText('Create directory')).not.toBeInTheDocument();
    });
  });

  it('uploads files and forwards metadata to the API', async () => {
    const node = buildNode();
    setupPollingResourcesForNode(node);
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([sampleMount]));
    const uploadedNode = buildNode({ id: 77, path: `${node.path}/upload.txt`, backendMountId: sampleMount.id, kind: 'file' });
    mocks.uploadFileMock.mockResolvedValueOnce({
      idempotent: false,
      journalEntryId: 21,
      node: uploadedNode,
      result: { path: uploadedNode.path }
    });

    render(<FilestoreExplorerPage identity={writableIdentity} />);

    const [openUploadButton] = await screen.findAllByRole('button', { name: 'Upload file' });
    fireEvent.click(openUploadButton);

    const uploadDialog = await screen.findByRole('dialog', { name: 'Upload file' });

    const fileInput = within(uploadDialog).getByLabelText('Browse…');
    const file = new File(['content'], 'upload.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const pathField = within(uploadDialog).getByLabelText('File path');
    expect((pathField as HTMLInputElement).value).toBe(`${node.path}/upload.txt`);

    const submitUploadButton = within(uploadDialog).getByRole('button', { name: 'Upload file' });
    fireEvent.click(submitUploadButton);

    await waitFor(() => {
      expect(mocks.uploadFileMock).toHaveBeenCalledTimes(1);
    });
    const [, uploadPayload] = mocks.uploadFileMock.mock.calls[0];
    expect((uploadPayload as { path: string }).path).toBe(`${node.path}/upload.txt`);
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Upload queued');
  });

  it('soft-deletes nodes after confirmation', async () => {
    const node = buildNode();
    setupPollingResourcesForNode(node);
    mocks.listBackendMountsMock.mockResolvedValueOnce(buildMountList([sampleMount]));
    mocks.deleteNodeMock.mockResolvedValueOnce({
      idempotent: false,
      journalEntryId: 31,
      node: null,
      result: { path: node.path }
    });

    render(<FilestoreExplorerPage identity={writableIdentity} />);

    const [openDeleteButton] = await screen.findAllByRole('button', { name: 'Soft-delete' });
    fireEvent.click(openDeleteButton);

    const deleteDialog = await screen.findByRole('alertdialog', { name: 'Soft-delete node' });

    const confirmationInput = within(deleteDialog).getByLabelText(/Type/);
    const nodeName = node.path.split('/').pop() ?? node.path;
    fireEvent.change(confirmationInput, { target: { value: nodeName } });

    const confirmDeleteButton = within(deleteDialog).getByRole('button', { name: 'Soft-delete' });
    fireEvent.click(confirmDeleteButton);

    await waitFor(() => {
      expect(mocks.deleteNodeMock).toHaveBeenCalledTimes(1);
    });
    const [, deletePayload] = mocks.deleteNodeMock.mock.calls[0];
    expect((deletePayload as { path: string }).path).toBe(node.path);
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Delete enqueued');
  });
});

describe('FilestoreExplorerPage playbooks', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listBackendMountsMock.mockReset();
    mocks.listBackendMountsMock.mockResolvedValue(buildMountList([sampleMount]));
    mocks.enqueueReconciliationMock.mockReset();
    mocks.enqueueReconciliationMock.mockResolvedValue(undefined);
    mocks.listWorkflowDefinitionsMock.mockReset();
    mocks.listWorkflowDefinitionsMock.mockResolvedValue([]);
    mocks.triggerWorkflowRunMock.mockReset();
    mocks.triggerWorkflowRunMock.mockResolvedValue({ id: 'run-123' } as WorkflowRun);
    mocks.listReconciliationJobsMock.mockReset();
    mocks.listReconciliationJobsMock.mockResolvedValue({
      jobs: [],
      pagination: { total: 0, limit: 20, offset: 0, nextOffset: null },
      filters: { backendMountId: null, path: null, status: [] }
    });
    mocks.fetchReconciliationJobMock.mockReset();
    mocks.fetchReconciliationJobMock.mockResolvedValue(null);
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
