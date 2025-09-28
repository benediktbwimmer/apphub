import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventsExplorerPage from '../EventsExplorerPage';
import { DEFAULT_EVENTS_FILTERS, EVENTS_EXPLORER_PRESETS } from '../explorerTypes';
import type { EventsExplorerState } from '../useEventsExplorer';
import type { WorkflowEventSample, WorkflowEventSchema } from '../../workflows/types';
import { useEventsExplorer } from '../useEventsExplorer';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () =>
      Array.from({ length: count }).map((_, index) => ({
        index,
        key: index,
        start: index * 100
      }))
  })
}));

vi.mock('../useEventsExplorer', () => ({
  useEventsExplorer: vi.fn()
}));

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: vi.fn(() => vi.fn())
}));

vi.mock('../useSavedEventViews', () => ({
  useSavedEventViews: vi.fn(() => ({
    savedViews: [],
    loading: false,
    error: null,
    mutationState: {
      creating: false,
      applyingSlug: null,
      sharingSlug: null,
      updatingSlug: null,
      deletingSlug: null
    },
    viewerSubject: 'user:test',
    viewerUserId: 'user-test',
    refresh: vi.fn(),
    createSavedView: vi.fn(),
    updateSavedView: vi.fn(),
    deleteSavedView: vi.fn(),
    applySavedView: vi.fn(),
    shareSavedView: vi.fn()
  }))
}));

vi.mock('../useEventHealthSnapshot', () => ({
  useEventHealthSnapshot: vi.fn(() => ({
    health: null,
    loading: false,
    refreshing: false,
    error: null,
    lastUpdatedAt: null,
    refresh: vi.fn()
  }))
}));

const useEventsExplorerMock = vi.mocked(useEventsExplorer);

const sampleEvents: WorkflowEventSample[] = [
  {
    id: 'evt-1',
    type: 'metastore.record.updated',
    source: 'metastore.api',
    occurredAt: '2025-01-02T12:00:00.000Z',
    receivedAt: '2025-01-02T12:00:01.000Z',
    payload: { assetId: 'asset-1', status: 'updated' },
    correlationId: 'req-123',
    ttlMs: null,
    metadata: { region: 'iad' },
    severity: 'warning',
    links: { workflowDefinitionIds: ['wf-1'] },
    derived: null
  },
  {
    id: 'evt-2',
    type: 'asset.produced',
    source: 'workflows.events',
    occurredAt: '2025-01-02T12:05:00.000Z',
    receivedAt: '2025-01-02T12:05:02.000Z',
    payload: { assetId: 'asset-2', producedAt: '2025-01-02T12:05:00.000Z' },
    correlationId: null,
    ttlMs: null,
    metadata: null,
    severity: 'info',
    links: null,
    derived: null
  }
];

const sampleSchema: WorkflowEventSchema = {
  totalSamples: 2,
  fields: [
    {
      path: ['payload', 'assetId'],
      jsonPath: '$.payload.assetId',
      liquidPath: "event.payload.assetId",
      occurrences: 2,
      types: ['string'],
      kind: 'value',
      examples: ['asset-1']
    }
  ]
};

beforeEach(() => {
  const state: EventsExplorerState = {
    filters: DEFAULT_EVENTS_FILTERS,
    presets: EVENTS_EXPLORER_PRESETS,
    activePresetId: 'all',
    events: sampleEvents,
    schema: sampleSchema,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    connectionStatus: 'connected',
    highlightedIds: new Set([sampleEvents[0].id]),
    applyFilters: vi.fn().mockResolvedValue(undefined),
    applyPreset: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined)
  };
  useEventsExplorerMock.mockReturnValue(state);
});

describe('EventsExplorerPage', () => {
  it('renders events and opens the detail drawer', async () => {
    render(<EventsExplorerPage />);

    expect(screen.getByText('Events Explorer')).toBeInTheDocument();
    expect(screen.getByText('Live events')).toBeInTheDocument();
    await screen.findByText('New');

    const user = userEvent.setup();
    const eventCard = await screen.findByText(/metastore\.record\.updated/);
    await user.click(eventCard);

    await screen.findByRole('heading', { level: 3, name: 'Envelope' });
    await screen.findByRole('heading', { level: 3, name: 'Payload' });

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: 'Envelope' })).not.toBeInTheDocument()
    );
  });
});
