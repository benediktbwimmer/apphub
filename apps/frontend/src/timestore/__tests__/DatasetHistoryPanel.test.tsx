import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DatasetHistoryPanel from '../components/DatasetHistoryPanel';
import type { DatasetAccessAuditEvent } from '../types';

const baseEvent: DatasetAccessAuditEvent = {
  id: 'event-1',
  datasetId: 'ds-1',
  datasetSlug: 'dataset-one',
  actorId: 'user-1',
  actorScopes: ['timestore:admin'],
  action: 'ingest',
  success: true,
  metadata: {
    mode: 'inline',
    manifestId: 'manifest-123',
    durationSeconds: 1.42,
    jobId: 'job-999'
  },
  createdAt: new Date('2024-05-01T10:00:00Z').toISOString()
};

const noop = vi.fn();

describe('DatasetHistoryPanel', () => {
  it('shows scope gating message when user cannot view history', () => {
    render(
      <DatasetHistoryPanel
        events={[]}
        loading={false}
        loadingMore={false}
        error={null}
        canView={false}
        hasMore={false}
        lastFetchedAt={null}
        onRefresh={noop}
        onLoadMore={noop}
      />
    );

    expect(screen.getByText(/timestore:admin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('renders empty state when no events are available', () => {
    render(
      <DatasetHistoryPanel
        events={[]}
        loading={false}
        loadingMore={false}
        error={null}
        canView
        hasMore={false}
        lastFetchedAt={null}
        onRefresh={noop}
        onLoadMore={noop}
      />
    );

    expect(screen.getByText(/No history recorded yet/i)).toBeInTheDocument();
  });

  it('renders audit event details and metadata links', () => {
    render(
      <DatasetHistoryPanel
        events={[baseEvent]}
        loading={false}
        loadingMore={false}
        error={null}
        canView
        hasMore={false}
        lastFetchedAt={baseEvent.createdAt}
        onRefresh={noop}
        onLoadMore={noop}
      />
    );

    expect(screen.getByText(/Ingestion completed/)).toBeInTheDocument();
    expect(screen.getByText('Manifest')).toBeInTheDocument();
    const manifestLink = screen.getByRole('link', { name: /manifest-123/i });
    expect(manifestLink).toHaveAttribute('href', '#timestore-manifest');
    const jobLink = screen.getByRole('link', { name: /job-999/i });
    expect(jobLink).toHaveAttribute('href', '#timestore-job-job-999');
    expect(screen.getByText(/Duration/)).toBeInTheDocument();
  });

  it('invokes load more handler', async () => {
    const user = userEvent.setup();
    const handleLoadMore = vi.fn();

    render(
      <DatasetHistoryPanel
        events={[baseEvent]}
        loading={false}
        loadingMore={false}
        error={null}
        canView
        hasMore
        lastFetchedAt={baseEvent.createdAt}
        onRefresh={noop}
        onLoadMore={handleLoadMore}
      />
    );

    await user.click(screen.getByRole('button', { name: /Load older events/i }));
    expect(handleLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders error state', () => {
    render(
      <DatasetHistoryPanel
        events={[]}
        loading={false}
        loadingMore={false}
        error="failed to load"
        canView
        hasMore={false}
        lastFetchedAt={null}
        onRefresh={noop}
        onLoadMore={noop}
      />
    );

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
