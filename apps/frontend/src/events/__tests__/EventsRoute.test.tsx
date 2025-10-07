import { render, screen } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventsExplorerState } from '../useEventsExplorer';
import EventsExplorerPage from '../EventsExplorerPage';
import { DEFAULT_EVENTS_FILTERS, EVENTS_EXPLORER_PRESETS } from '../explorerTypes';
import type { WorkflowEventSample } from '../../workflows/types';
import {
  AppHubEventsContext,
  type AppHubConnectionHandler,
  type AppHubEventHandler,
  type AppHubEventsClient
} from '../context';
import { useEventsExplorer } from '../useEventsExplorer';
import { ModuleScopeContextProvider, type ModuleScopeContextValue } from '../../modules/ModuleScopeContext';
import type { ReactNode } from 'react';

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

const mockEvents: WorkflowEventSample[] = [
  {
    id: 'evt-101',
    type: 'workflow.event.received',
    source: 'workflow.scheduler',
    occurredAt: '2025-02-01T10:00:00.000Z',
    receivedAt: '2025-02-01T10:00:01.000Z',
    payload: { workflow: 'inventory-refresh' },
    correlationId: 'req-401',
    ttlMs: null,
    metadata: null,
    severity: 'info',
    links: null,
    derived: null
  }
];

const appHubClient: AppHubEventsClient = {
  subscribe: (handler: AppHubEventHandler) => {
    handler({ type: 'connection.ack', data: { now: new Date().toISOString() } });
    return () => {};
  },
  subscribeConnection: (handler: AppHubConnectionHandler) => {
    handler('connected');
    return () => {};
  },
  getConnectionState: () => 'connected'
};

beforeEach(() => {
  const state: EventsExplorerState = {
    filters: DEFAULT_EVENTS_FILTERS,
    presets: EVENTS_EXPLORER_PRESETS,
    activePresetId: 'all',
    events: mockEvents,
    schema: null,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    hasMore: true,
    connectionStatus: 'connected',
    highlightedIds: new Set(),
    applyFilters: vi.fn().mockResolvedValue(undefined),
    applyPreset: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined)
  };
  useEventsExplorerMock.mockReturnValue(state);
});

const moduleScopeStub: ModuleScopeContextValue = {
  kind: 'module',
  moduleId: 'test-module',
  moduleVersion: '1.0.0',
  modules: [],
  loadingModules: false,
  modulesError: null,
  resources: [],
  loadingResources: false,
  resourcesError: null,
  setModuleId: vi.fn(),
  buildModulePath: (path: string) => path,
  stripModulePrefix: (pathname: string) => pathname,
  getResourceContexts: () => [],
  getResourceIds: () => [],
  getResourceSlugs: () => [],
  isResourceInScope: () => true
};

function withModuleScope(children: ReactNode) {
  return (
    <ModuleScopeContextProvider value={moduleScopeStub}>
      {children}
    </ModuleScopeContextProvider>
  );
}

describe('events route smoke test', () => {
  it('navigates to /events and renders fixture data', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: withModuleScope(
            <AppHubEventsContext.Provider value={appHubClient}>
              <Outlet />
            </AppHubEventsContext.Provider>
          ),
          children: [
            {
              path: 'events',
              element: <EventsExplorerPage />
            }
          ]
        }
      ],
      { initialEntries: ['/events'] }
    );

    render(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe('/events');
    expect(screen.getByText('Events Explorer')).toBeInTheDocument();
    await screen.findByText(/workflow\.event\.received/i);
    expect(screen.getByRole('button', { name: /Load older events/i })).toBeEnabled();
  });
});
