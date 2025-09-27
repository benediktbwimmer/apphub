import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilestoreExplorerPage from '../FilestoreExplorerPage';
import type { FilestoreBackendMount } from '../types';

const listBackendMountsMock = vi.fn<
  (...args: unknown[]) => Promise<{ mounts: FilestoreBackendMount[] }>
>();
const subscribeToFilestoreEventsMock = vi.fn(() => ({ close: vi.fn() }));
const trackEventMock = vi.fn();
const pollingResourceMock = vi.fn(() => ({
  data: null,
  error: null,
  loading: false,
  refetch: vi.fn()
}));
const authorizedFetchMock = vi.fn();
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
  usePollingResource: (config: unknown) => pollingResourceMock(config)
}));

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

vi.mock('../api', () => ({
  __esModule: true,
  enqueueReconciliation: vi.fn(),
  fetchNodeById: vi.fn(),
  fetchNodeChildren: vi.fn(),
  listBackendMounts: (...args: unknown[]) => listBackendMountsMock(...args),
  listNodes: vi.fn(),
  subscribeToFilestoreEvents: (...args: unknown[]) => subscribeToFilestoreEventsMock(...args),
  updateNodeMetadata: vi.fn()
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
