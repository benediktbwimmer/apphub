import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { searchRecordsMock, fetchRecordMock } = vi.hoisted(() => ({
  searchRecordsMock: vi.fn(),
  fetchRecordMock: vi.fn()
}));

const toastSpies = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn()
}));

const recordTableController = vi.hoisted(() => ({
  onRetry: null as (() => void) | null
}));

const authorizedFetchStub = vi.hoisted(() => vi.fn());

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    identity: {
      scopes: ['metastore:admin', 'metastore:delete', 'metastore:write', 'metastore:read']
    },
    activeToken: 'test-token'
  })
}));

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchStub
}));

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => toastSpies
}));

vi.mock('../useSchemaDefinition', () => ({
  useSchemaDefinition: () => ({
    status: 'idle',
    schema: null,
    loading: false,
    error: null,
    missingMessage: null
  })
}));

vi.mock('../components/NamespacePicker', () => ({
  NamespacePicker: ({ value }: { value: string }) => (
    <div data-testid="namespace-picker">Namespace: {value}</div>
  )
}));

vi.mock('../components/RecordTable', () => ({
  RecordTable: (props: { onRetry: () => void }) => {
    recordTableController.onRetry = props.onRetry;
    return <div data-testid="record-table" />;
  }
}));

vi.mock('../components/AuditTrailPanel', () => ({
  AuditTrailPanel: () => <div data-testid="audit-trail" />
}));

vi.mock('../components/RealtimeActivityRail', () => ({
  RealtimeActivityRail: () => <div data-testid="realtime-activity" />
}));

vi.mock('../components/FilestoreHealthRail', () => ({
  FilestoreHealthRail: () => <div data-testid="filestore-health" />
}));

vi.mock('../components/SchemaAwareMetadataEditor', () => ({
  default: () => <div data-testid="schema-editor" />
}));

vi.mock('../components/MetastoreQueryBuilder', () => ({
  MetastoreQueryBuilder: () => <div data-testid="query-builder" />
}));

vi.mock('../components/BulkOperationsDialog', () => ({
  BulkOperationsDialog: () => null
}));

vi.mock('../../components/JsonSyntaxHighlighter', () => ({
  default: () => <pre data-testid="json-viewer" />
}));

vi.mock('../api', () => ({
  searchRecords: searchRecordsMock,
  fetchRecord: fetchRecordMock,
  upsertRecord: vi.fn(),
  patchRecord: vi.fn(),
  deleteRecord: vi.fn(),
  purgeRecord: vi.fn(),
  bulkOperate: vi.fn()
}));

import MetastoreExplorerPage from '../MetastoreExplorerPage';

describe('MetastoreExplorerPage', () => {
  beforeEach(() => {
    searchRecordsMock.mockReset();
    fetchRecordMock.mockReset();
    authorizedFetchStub.mockReset();
    recordTableController.onRetry = null;
    toastSpies.showSuccess.mockReset();
    toastSpies.showError.mockReset();
    toastSpies.showInfo.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('avoids refetching record details when polling returns identical summaries', async () => {
    const recordSummary = {
      id: 'rec-1',
      namespace: 'default',
      recordKey: 'sample-record',
      owner: 'analytics@apphub.dev',
      schemaHash: null,
      version: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T01:00:00.000Z',
      deletedAt: null,
      metadata: {},
      tags: []
    } as const;

    searchRecordsMock.mockResolvedValue({
      pagination: { total: 1, limit: 25, offset: 0 },
      records: [recordSummary]
    });

    fetchRecordMock.mockResolvedValue({
      ...recordSummary,
      metadata: { status: 'active' },
      tags: []
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/', search: '?namespace=default' }]}>
        <Routes>
          <Route path="/" element={<MetastoreExplorerPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchRecordMock).toHaveBeenCalledTimes(1));

    expect(recordTableController.onRetry).toBeTypeOf('function');

    act(() => {
      recordTableController.onRetry?.();
    });

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchRecordMock).toHaveBeenCalledTimes(1));
  });

  it('submits a full-text search when query is applied', async () => {
    searchRecordsMock.mockResolvedValue({
      pagination: { total: 0, limit: 25, offset: 0 },
      records: []
    });

    const user = userEvent.setup();

    const { getByRole } = render(
      <MemoryRouter initialEntries={[{ pathname: '/', search: '?namespace=default' }]}>
        <Routes>
          <Route path="/" element={<MetastoreExplorerPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(1));

    const searchInput = getByRole('searchbox', { name: /full-text search/i });
    const runButton = getByRole('button', { name: /run search/i });

    await user.clear(searchInput);
    await user.type(searchInput, 'logs');
    await user.click(runButton);

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(2));

    const [, requestBody] = searchRecordsMock.mock.calls[1];
    expect(requestBody).toMatchObject({
      namespace: 'default',
      search: 'logs'
    });
    expect(requestBody).not.toHaveProperty('q');
    expect(requestBody).not.toHaveProperty('filter');
  });

  it('blocks short full-text search entries with feedback', async () => {
    searchRecordsMock.mockResolvedValue({
      pagination: { total: 0, limit: 25, offset: 0 },
      records: []
    });

    const user = userEvent.setup();

    const { getByRole } = render(
      <MemoryRouter initialEntries={[{ pathname: '/', search: '?namespace=default' }]}>
        <Routes>
          <Route path="/" element={<MetastoreExplorerPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(1));

    const searchInput = getByRole('searchbox', { name: /full-text search/i });
    const runButton = getByRole('button', { name: /run search/i });

    await user.clear(searchInput);
    await user.type(searchInput, 'x');
    await user.click(runButton);

    expect(searchRecordsMock).toHaveBeenCalledTimes(1);
    expect(toastSpies.showError).toHaveBeenCalledWith(
      'Full-text search requires more input',
      undefined,
      'Enter at least two characters to run a full-text search.'
    );
  });

  it('clears full-text search and reapplies structured query', async () => {
    searchRecordsMock.mockResolvedValue({
      pagination: { total: 0, limit: 25, offset: 0 },
      records: []
    });

    const user = userEvent.setup();

    const { getByRole } = render(
      <MemoryRouter initialEntries={[{ pathname: '/', search: '?namespace=default' }]}>
        <Routes>
          <Route path="/" element={<MetastoreExplorerPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(1));

    const searchInput = getByRole('searchbox', { name: /full-text search/i });
    const runButton = getByRole('button', { name: /run search/i });
    const clearButton = getByRole('button', { name: /clear search/i });

    await user.type(searchInput, 'alerts');
    await user.click(runButton);

    await waitFor(() => expect(searchRecordsMock).toHaveBeenCalledTimes(2));

    await user.click(clearButton);

    await waitFor(() => expect(searchRecordsMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    const lastCall = searchRecordsMock.mock.calls.at(-1)!;
    expect(lastCall[1]).not.toHaveProperty('search');
    expect(lastCall[1]).not.toHaveProperty('q');
  });
});
