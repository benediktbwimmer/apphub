import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatasetAdminPanel from '../components/DatasetAdminPanel';
import type { DatasetRecord } from '../types';

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
const updateDatasetMock = vi.fn();
const archiveDatasetMock = vi.fn();

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

vi.mock('../api', () => ({
  __esModule: true,
  updateDataset: (...args: unknown[]) => updateDatasetMock(...args),
  archiveDataset: (...args: unknown[]) => archiveDatasetMock(...args)
}));

const BASE_DATASET: DatasetRecord = {
  id: 'ds-1',
  slug: 'observatory.events',
  name: 'Observatory Events',
  displayName: 'Observatory Events',
  description: 'Initial description',
  status: 'active',
  writeFormat: 'clickhouse',
  defaultStorageTargetId: 'st-1',
  metadata: {
    iam: {
      readScopes: ['timestore:read'],
      writeScopes: ['timestore:write']
    }
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z'
};

describe('DatasetAdminPanel', () => {
  beforeEach(() => {
    authorizedFetchMock.mockReset();
    updateDatasetMock.mockReset();
    archiveDatasetMock.mockReset();
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
  });

  it('updates dataset metadata and scopes', async () => {
    const user = userEvent.setup();
    const updatedRecord: DatasetRecord = {
      ...BASE_DATASET,
      name: 'Observatory Events Refined',
      metadata: {
        iam: {
          readScopes: ['timestore:read', 'observatory:read'],
          writeScopes: ['timestore:write']
        }
      },
      updatedAt: '2024-01-03T00:00:00.000Z'
    };
    updateDatasetMock.mockResolvedValue({ dataset: updatedRecord, etag: updatedRecord.updatedAt });
    const handleChange = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <DatasetAdminPanel
        dataset={BASE_DATASET}
        canEdit
        onDatasetChange={handleChange}
        onRequireListRefresh={handleRefresh}
      />
    );

    await user.clear(screen.getByLabelText(/^Name$/i));
    await user.type(screen.getByLabelText(/^Name$/i), 'Observatory Events Refined');
    await user.clear(screen.getByLabelText(/^Read scopes/i));
    await user.type(screen.getByLabelText(/^Read scopes/i), 'timestore:read\nobservatory:read');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateDatasetMock).toHaveBeenCalledTimes(1);
    });

    expect(updateDatasetMock).toHaveBeenCalledWith(authorizedFetchMock, BASE_DATASET.id, {
      name: 'Observatory Events Refined',
      metadata: {
        iam: {
          readScopes: ['timestore:read', 'observatory:read']
        }
      },
      ifMatch: BASE_DATASET.updatedAt
    });
    expect(handleChange).toHaveBeenCalledWith(updatedRecord);
    expect(handleRefresh).toHaveBeenCalled();
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Dataset updated', 'Metadata changes saved.');
  });

  it('archives dataset with optional reason', async () => {
    const user = userEvent.setup();
    const archivedRecord: DatasetRecord = { ...BASE_DATASET, status: 'inactive', updatedAt: '2024-01-03T00:00:00.000Z' };
    archiveDatasetMock.mockResolvedValue({ dataset: archivedRecord, etag: archivedRecord.updatedAt });
    const handleChange = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <DatasetAdminPanel
        dataset={BASE_DATASET}
        canEdit
        onDatasetChange={handleChange}
        onRequireListRefresh={handleRefresh}
      />
    );

    await user.click(screen.getByRole('button', { name: /archive dataset/i }));
    const reasonField = screen.getByPlaceholderText(/explain why/i);
    await user.type(reasonField, '  cleanup  ');
    await user.click(screen.getByRole('button', { name: /confirm archive/i }));

    await waitFor(() => {
      expect(archiveDatasetMock).toHaveBeenCalledTimes(1);
    });

    expect(archiveDatasetMock).toHaveBeenCalledWith(authorizedFetchMock, BASE_DATASET.id, {
      reason: 'cleanup',
      ifMatch: BASE_DATASET.updatedAt
    });
    expect(handleChange).toHaveBeenCalledWith(archivedRecord);
    expect(handleRefresh).toHaveBeenCalled();
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Dataset archived', expect.stringContaining(BASE_DATASET.slug));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /confirm archive/i })).not.toBeInTheDocument();
    });
  });

  it('reactivates inactive datasets', async () => {
    const user = userEvent.setup();
    const inactiveDataset: DatasetRecord = { ...BASE_DATASET, status: 'inactive' };
    const reactivated: DatasetRecord = { ...inactiveDataset, status: 'active', updatedAt: '2024-01-03T00:00:00.000Z' };
    updateDatasetMock.mockResolvedValue({ dataset: reactivated, etag: reactivated.updatedAt });
    const handleChange = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <DatasetAdminPanel
        dataset={inactiveDataset}
        canEdit
        onDatasetChange={handleChange}
        onRequireListRefresh={handleRefresh}
      />
    );

    await user.click(screen.getByRole('button', { name: /reactivate dataset/i }));

    await waitFor(() => {
      expect(updateDatasetMock).toHaveBeenCalledTimes(1);
    });

    expect(updateDatasetMock).toHaveBeenCalledWith(authorizedFetchMock, inactiveDataset.id, {
      status: 'active',
      ifMatch: inactiveDataset.updatedAt
    });
    expect(handleChange).toHaveBeenCalledWith(reactivated);
    expect(handleRefresh).toHaveBeenCalled();
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith('Dataset reactivated', expect.stringContaining(inactiveDataset.slug));
  });

  it('disables editing without admin scope', () => {
    const handleChange = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <DatasetAdminPanel
        dataset={BASE_DATASET}
        canEdit={false}
        onDatasetChange={handleChange}
        onRequireListRefresh={handleRefresh}
      />
    );

    expect(screen.getByText(/timestore:admin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /archive dataset/i })).not.toBeInTheDocument();
  });

  it('surfaces errors when update fails', async () => {
    const user = userEvent.setup();
    updateDatasetMock.mockRejectedValue(new Error('conflict detected'));
    const handleChange = vi.fn();

    render(
      <DatasetAdminPanel
        dataset={BASE_DATASET}
        canEdit
        onDatasetChange={handleChange}
        onRequireListRefresh={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText(/^Name$/i));
    await user.type(screen.getByLabelText(/^Name$/i), 'Conflicting Update');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateDatasetMock).toHaveBeenCalledTimes(1);
    });

    expect(handleChange).not.toHaveBeenCalled();
    expect(toastHelpersMock.showError).toHaveBeenCalledWith('Failed to update dataset', expect.any(Error));
    expect(screen.getByText('conflict detected')).toBeInTheDocument();
  });
});
