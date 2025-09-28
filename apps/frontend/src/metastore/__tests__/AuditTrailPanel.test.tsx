import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetastoreRecordDetail } from '../types';

vi.mock('../api', () => ({
  fetchRecordAudits: vi.fn(),
  fetchRecordAuditDiff: vi.fn(),
  restoreRecordFromAudit: vi.fn()
}));

vi.mock('../../components/JsonSyntaxHighlighter', () => ({
  __esModule: true,
  default: ({ value }: { value: unknown }) => <pre data-testid="json">{JSON.stringify(value)}</pre>
}));

import { AuditTrailPanel } from '../components/AuditTrailPanel';
import { fetchRecordAudits, fetchRecordAuditDiff, restoreRecordFromAudit } from '../api';

const fetchRecordAuditsMock = vi.mocked(fetchRecordAudits);
const fetchRecordAuditDiffMock = vi.mocked(fetchRecordAuditDiff);
const restoreRecordFromAuditMock = vi.mocked(restoreRecordFromAudit);

const baseRecord: MetastoreRecordDetail = {
  id: 'rec-1',
  namespace: 'analytics',
  recordKey: 'pipeline-1',
  displayName: 'Pipeline 1',
  owner: 'alice@apphub.dev',
  schemaHash: 'abc123',
  version: 5,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  deletedAt: null,
  metadata: { status: 'active' },
  tags: ['pipelines']
};

const authorizedFetchMock = vi.fn(async () => new Response('{}'));
const showSuccessMock = vi.fn();
const showErrorMock = vi.fn();
const showInfoMock = vi.fn();
const onRecordRestoredMock = vi.fn();
const onRefreshRecordsMock = vi.fn();

beforeEach(() => {
  fetchRecordAuditsMock.mockReset();
  fetchRecordAuditDiffMock.mockReset();
  restoreRecordFromAuditMock.mockReset();
  authorizedFetchMock.mockClear();
  showSuccessMock.mockReset();
  showErrorMock.mockReset();
  showInfoMock.mockReset();
  onRecordRestoredMock.mockReset();
  onRefreshRecordsMock.mockReset();
});

describe('AuditTrailPanel', () => {
  it('renders audit entries and paginates results', async () => {
    fetchRecordAuditsMock
      .mockResolvedValueOnce({
        pagination: { total: 40, limit: 20, offset: 0 },
        entries: [
          {
            id: 1,
            namespace: 'analytics',
            recordKey: 'pipeline-1',
            action: 'create',
            actor: 'alice',
            previousVersion: null,
            version: 1,
            metadata: {},
            previousMetadata: null,
            tags: ['pipelines'],
            previousTags: null,
            owner: 'alice',
            previousOwner: null,
            schemaHash: 'v1',
            previousSchemaHash: null,
            createdAt: '2024-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({
        pagination: { total: 40, limit: 20, offset: 20 },
        entries: [
          {
            id: 2,
            namespace: 'analytics',
            recordKey: 'pipeline-1',
            action: 'update',
            actor: 'bob',
            previousVersion: 1,
            version: 2,
            metadata: {},
            previousMetadata: {},
            tags: ['pipelines'],
            previousTags: ['pipelines'],
            owner: 'alice',
            previousOwner: 'alice',
            schemaHash: 'v2',
            previousSchemaHash: 'v1',
            createdAt: '2024-01-02T00:00:00.000Z'
          }
        ]
      });

    render(
      <AuditTrailPanel
        record={baseRecord}
        authorizedFetch={authorizedFetchMock}
        hasWriteScope={false}
        onRecordRestored={onRecordRestoredMock}
        onRefreshRecords={onRefreshRecordsMock}
        showSuccess={showSuccessMock}
        showError={showErrorMock}
        showInfo={showInfoMock}
      />
    );

    await waitFor(() => expect(fetchRecordAuditsMock).toHaveBeenCalledTimes(1));

    expect(await screen.findByRole('cell', { name: /alice/i })).toBeInTheDocument();
    expect(screen.getByText(/Total 40/i)).toBeInTheDocument();

    const nextButton = screen.getByRole('button', { name: /Next/i });
    expect(nextButton).not.toBeDisabled();
    await userEvent.click(nextButton);

    await waitFor(() => expect(fetchRecordAuditsMock).toHaveBeenCalledTimes(2));
    const secondCallOptions = fetchRecordAuditsMock.mock.calls[1]?.[3];
    expect(secondCallOptions?.offset).toBe(20);
    expect(secondCallOptions?.limit).toBe(20);

    expect(await screen.findByRole('cell', { name: /bob/i })).toBeInTheDocument();
  });

  it('loads diff data when requested and displays metadata changes', async () => {
    fetchRecordAuditsMock.mockResolvedValue({
      pagination: { total: 1, limit: 20, offset: 0 },
      entries: [
        {
          id: 3,
          namespace: 'analytics',
          recordKey: 'pipeline-1',
          action: 'update',
          actor: 'carol',
          previousVersion: 4,
          version: 5,
          metadata: {},
          previousMetadata: {},
          tags: ['pipelines'],
          previousTags: ['pipelines'],
          owner: 'alice',
          previousOwner: 'alice',
          schemaHash: 'v5',
          previousSchemaHash: 'v4',
          createdAt: '2024-01-03T00:00:00.000Z'
        }
      ]
    });

    fetchRecordAuditDiffMock.mockResolvedValue({
      audit: {
        id: 3,
        namespace: 'analytics',
        key: 'pipeline-1',
        action: 'update',
        actor: 'carol',
        previousVersion: 4,
        version: 5,
        createdAt: '2024-01-03T00:00:00.000Z'
      },
      metadata: {
        added: [],
        removed: [],
        changed: [{ path: 'status', before: 'active', after: 'retired' }]
      },
      tags: { added: [], removed: [] },
      owner: { before: 'alice', after: 'alice', changed: false },
      schemaHash: { before: 'v4', after: 'v5', changed: true },
      snapshots: {
        current: { metadata: { status: 'retired' }, tags: ['pipelines'], owner: 'alice', schemaHash: 'v5' },
        previous: { metadata: { status: 'active' }, tags: ['pipelines'], owner: 'alice', schemaHash: 'v4' }
      }
    });

    render(
      <AuditTrailPanel
        record={baseRecord}
        authorizedFetch={authorizedFetchMock}
        hasWriteScope={false}
        onRecordRestored={onRecordRestoredMock}
        onRefreshRecords={onRefreshRecordsMock}
        showSuccess={showSuccessMock}
        showError={showErrorMock}
        showInfo={showInfoMock}
      />
    );

    await waitFor(() => expect(fetchRecordAuditsMock).toHaveBeenCalled());

    const viewDiffButton = await screen.findByRole('button', { name: /View diff/i });
    await userEvent.click(viewDiffButton);

    await waitFor(() => expect(fetchRecordAuditDiffMock).toHaveBeenCalledWith(authorizedFetchMock, 'analytics', 'pipeline-1', 3, expect.any(Object)));

    expect(await screen.findByText(/Metadata changes/i)).toBeInTheDocument();
    expect(screen.getByText(/Changed paths \(1\)/i)).toBeInTheDocument();
  });

  it('restores from audit entry when confirmed', async () => {
    fetchRecordAuditsMock.mockResolvedValue({
      pagination: { total: 1, limit: 20, offset: 0 },
      entries: [
        {
          id: 4,
          namespace: 'analytics',
          recordKey: 'pipeline-1',
          action: 'update',
          actor: 'dave',
          previousVersion: 4,
          version: 5,
          metadata: {},
          previousMetadata: {},
          tags: ['pipelines'],
          previousTags: ['pipelines'],
          owner: 'alice',
          previousOwner: 'alice',
          schemaHash: 'v5',
          previousSchemaHash: 'v4',
          createdAt: '2024-01-04T00:00:00.000Z'
        }
      ]
    });

    fetchRecordAuditDiffMock.mockResolvedValue({
      audit: {
        id: 4,
        namespace: 'analytics',
        key: 'pipeline-1',
        action: 'update',
        actor: 'dave',
        previousVersion: 4,
        version: 5,
        createdAt: '2024-01-04T00:00:00.000Z'
      },
      metadata: { added: [], removed: [], changed: [] },
      tags: { added: [], removed: [] },
      owner: { before: 'alice', after: 'alice', changed: false },
      schemaHash: { before: 'v4', after: 'v5', changed: true },
      snapshots: {
        current: { metadata: { status: 'retired' }, tags: ['pipelines'], owner: 'alice', schemaHash: 'v5' },
        previous: { metadata: { status: 'active' }, tags: ['pipelines'], owner: 'alice', schemaHash: 'v4' }
      }
    });

    restoreRecordFromAuditMock.mockResolvedValue({
      restored: true,
      record: {
        ...baseRecord,
        version: 6,
        metadata: { status: 'retired' }
      },
      restoredFrom: { auditId: 4, version: 5 }
    });

    render(
      <AuditTrailPanel
        record={baseRecord}
        authorizedFetch={authorizedFetchMock}
        hasWriteScope={true}
        onRecordRestored={onRecordRestoredMock}
        onRefreshRecords={onRefreshRecordsMock}
        showSuccess={showSuccessMock}
        showError={showErrorMock}
        showInfo={showInfoMock}
      />
    );

    await waitFor(() => expect(fetchRecordAuditsMock).toHaveBeenCalled());

    const viewDiffButton = await screen.findByRole('button', { name: /View diff/i });
    await userEvent.click(viewDiffButton);
    await waitFor(() => expect(fetchRecordAuditDiffMock).toHaveBeenCalled());

    const restoreButton = await screen.findByRole('button', { name: /Restore this version/i });
    await userEvent.click(restoreButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm restore/i });
    await userEvent.click(confirmButton);

    await waitFor(() => expect(restoreRecordFromAuditMock).toHaveBeenCalled());
    expect(restoreRecordFromAuditMock).toHaveBeenCalledWith(authorizedFetchMock, 'analytics', 'pipeline-1', {
      auditId: 4,
      expectedVersion: 5
    });

    expect(onRecordRestoredMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: 6, metadata: { status: 'retired' } })
    );
    expect(onRefreshRecordsMock).toHaveBeenCalled();
    expect(showSuccessMock).toHaveBeenCalledWith('Record restored', expect.stringContaining('#4'));
  });

  it('surfaces optimistic locking errors inline', async () => {
    fetchRecordAuditsMock.mockResolvedValue({
      pagination: { total: 1, limit: 20, offset: 0 },
      entries: [
        {
          id: 5,
          namespace: 'analytics',
          recordKey: 'pipeline-1',
          action: 'update',
          actor: 'erin',
          previousVersion: 4,
          version: 5,
          metadata: {},
          previousMetadata: {},
          tags: ['pipelines'],
          previousTags: ['pipelines'],
          owner: 'alice',
          previousOwner: 'alice',
          schemaHash: 'v5',
          previousSchemaHash: 'v4',
          createdAt: '2024-01-05T00:00:00.000Z'
        }
      ]
    });

    fetchRecordAuditDiffMock.mockResolvedValue({
      audit: {
        id: 5,
        namespace: 'analytics',
        key: 'pipeline-1',
        action: 'update',
        actor: 'erin',
        previousVersion: 4,
        version: 5,
        createdAt: '2024-01-05T00:00:00.000Z'
      },
      metadata: { added: [], removed: [], changed: [] },
      tags: { added: [], removed: [] },
      owner: { before: 'alice', after: 'alice', changed: false },
      schemaHash: { before: 'v4', after: 'v5', changed: false },
      snapshots: {
        current: { metadata: { status: 'retired' }, tags: ['pipelines'], owner: 'alice', schemaHash: 'v5' },
        previous: { metadata: { status: 'active' }, tags: ['pipelines'], owner: 'alice', schemaHash: 'v4' }
      }
    });

    const conflictError = new Error('Version conflict');
    restoreRecordFromAuditMock.mockRejectedValue(conflictError);

    render(
      <AuditTrailPanel
        record={baseRecord}
        authorizedFetch={authorizedFetchMock}
        hasWriteScope={true}
        onRecordRestored={onRecordRestoredMock}
        onRefreshRecords={onRefreshRecordsMock}
        showSuccess={showSuccessMock}
        showError={showErrorMock}
        showInfo={showInfoMock}
      />
    );

    await waitFor(() => expect(fetchRecordAuditsMock).toHaveBeenCalled());

    const viewDiffButton = await screen.findByRole('button', { name: /View diff/i });
    await userEvent.click(viewDiffButton);
    await waitFor(() => expect(fetchRecordAuditDiffMock).toHaveBeenCalled());

    const restoreButton = await screen.findByRole('button', { name: /Restore this version/i });
    await userEvent.click(restoreButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm restore/i });
    await userEvent.click(confirmButton);

    await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith('Restore failed', conflictError));

    expect(await screen.findByText(/Version conflict/)).toBeInTheDocument();
    expect(onRecordRestoredMock).not.toHaveBeenCalled();
  });
});
