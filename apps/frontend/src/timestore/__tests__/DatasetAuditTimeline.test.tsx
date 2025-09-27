import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DatasetAuditTimeline } from '../components/DatasetAuditTimeline';
import type { DatasetAccessAuditEvent } from '../types';

const BASE_EVENT: DatasetAccessAuditEvent = {
  id: 'evt-1',
  datasetId: 'ds-1',
  datasetSlug: 'telemetry.records',
  actorId: 'robot-one',
  actorScopes: ['timestore:admin'],
  action: 'ingest.completed',
  success: true,
  metadata: {
    stage: 'ingest',
    jobId: 'job-123',
    manifestId: 'dm-9',
    durationMs: 1250,
    mode: 'inline'
  },
  createdAt: '2024-03-20T12:00:00.000Z'
};

describe('DatasetAuditTimeline', () => {
  it('renders audit events with metadata controls', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <DatasetAuditTimeline
          events={[BASE_EVENT]}
          loading={false}
          error={null}
          loadMoreError={null}
          onRetry={vi.fn()}
          onLoadMore={vi.fn()}
          canView
          loadMoreAvailable={false}
          loadMoreLoading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Ingestion & Query Timeline')).toBeInTheDocument();
    const listItem = screen.getByRole('listitem');
    expect(within(listItem).getByText('Ingest')).toBeInTheDocument();
    expect(within(listItem).getByText('Success')).toBeInTheDocument();
    expect(within(listItem).getByText('Ingest · Completed')).toBeInTheDocument();
    expect(within(listItem).getByText(/Actor robot-one/)).toBeInTheDocument();
    expect(within(listItem).getByRole('link', { name: /Job job-123/i })).toBeInTheDocument();

    const toggleButton = within(listItem).getByRole('button', { name: /show raw metadata/i });
    await user.click(toggleButton);
    expect(within(listItem).getByText(/"manifestId": "dm-9"/)).toBeInTheDocument();
    await user.click(within(listItem).getByRole('button', { name: /hide raw metadata/i }));
  });

  it('disables refresh when scope missing and displays message', () => {
    render(
      <MemoryRouter>
        <DatasetAuditTimeline
          events={[]}
          loading={false}
          error={null}
          loadMoreError={null}
          onRetry={vi.fn()}
          onLoadMore={vi.fn()}
          canView={false}
          loadMoreAvailable={false}
          loadMoreLoading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Viewing audit history requires/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('exposes load more action and errors', async () => {
    const user = userEvent.setup();
    const handleLoadMore = vi.fn();

    render(
      <MemoryRouter>
        <DatasetAuditTimeline
          events={[BASE_EVENT]}
          loading={false}
          error="Primary fetch failed"
          loadMoreError="More results unavailable"
          onRetry={vi.fn()}
          onLoadMore={handleLoadMore}
          canView
          loadMoreAvailable
          loadMoreLoading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Primary fetch failed')).toBeInTheDocument();
    expect(screen.getByText('More results unavailable')).toBeInTheDocument();

    const loadMoreButton = screen.getByRole('button', { name: /load more/i });
    await user.click(loadMoreButton);
    expect(handleLoadMore).toHaveBeenCalled();
  });

  it('renders empty state when no events and not loading', () => {
    render(
      <MemoryRouter>
        <DatasetAuditTimeline
          events={[]}
          loading={false}
          error={null}
          loadMoreError={null}
          onRetry={vi.fn()}
          onLoadMore={vi.fn()}
          canView
          loadMoreAvailable={false}
          loadMoreLoading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/no audit history recorded yet/i)).toBeInTheDocument();
  });
});
