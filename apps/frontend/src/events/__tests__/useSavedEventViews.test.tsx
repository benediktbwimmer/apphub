import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventSavedViewRecord } from '@apphub/shared/eventsExplorer';
import { useSavedEventViews } from '../useSavedEventViews';

const authorizedFetchMock = vi.fn();

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: vi.fn(() => authorizedFetchMock)
}));

vi.mock('../../auth/useAuth', () => ({
  useAuth: vi.fn(() => ({
    identity: {
      subject: 'user:alice',
      userId: 'alice',
      scopes: []
    }
  }))
}));

const apiMocks = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  applyMock: vi.fn(),
  shareMock: vi.fn()
}));

vi.mock('../api', () => ({
  listSavedEventViews: apiMocks.listMock,
  createSavedEventView: apiMocks.createMock,
  updateSavedEventView: apiMocks.updateMock,
  deleteSavedEventView: apiMocks.deleteMock,
  applySavedEventView: apiMocks.applyMock,
  shareSavedEventView: apiMocks.shareMock
}));

describe('useSavedEventViews', () => {
  beforeEach(() => {
    apiMocks.listMock.mockResolvedValue([]);
    apiMocks.createMock.mockReset();
    apiMocks.updateMock.mockReset();
    apiMocks.deleteMock.mockReset();
    apiMocks.applyMock.mockReset();
    apiMocks.shareMock.mockReset();
  });

  it('loads views on mount and merges new entries', async () => {
    const initial: EventSavedViewRecord = {
      id: 'view-1',
      slug: 'view-1',
      name: 'Baseline',
      description: null,
      filters: {},
      visibility: 'private',
      appliedCount: 0,
      sharedCount: 0,
      lastAppliedAt: null,
      lastSharedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ownerKey: 'user:alice',
      ownerSubject: 'user:alice',
      ownerKind: 'user',
      ownerUserId: 'alice',
      analytics: null
    };
    apiMocks.listMock.mockResolvedValueOnce([initial]);

    const { result } = renderHook(() => useSavedEventViews());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.savedViews).toHaveLength(1);

    const created: EventSavedViewRecord = {
      ...initial,
      id: 'view-2',
      slug: 'view-2',
      name: 'Alerts',
      filters: { severity: ['critical'] },
      updatedAt: '2025-01-02T00:00:00.000Z'
    };
    apiMocks.createMock.mockResolvedValueOnce(created);

    await act(async () => {
      await result.current.createSavedView({
        name: created.name,
        description: created.description,
        visibility: created.visibility,
        filters: created.filters
      });
    });

    expect(result.current.savedViews).toHaveLength(2);
    expect(result.current.savedViews.map((view) => view.name)).toEqual(['Alerts', 'Baseline']);
  });

  it('records apply mutations and updates analytics', async () => {
    const base: EventSavedViewRecord = {
      id: 'view-1',
      slug: 'view-1',
      name: 'Errors',
      description: null,
      filters: { severity: ['error'] },
      visibility: 'shared',
      appliedCount: 1,
      sharedCount: 2,
      lastAppliedAt: null,
      lastSharedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ownerKey: 'user:alice',
      ownerSubject: 'user:alice',
      ownerKind: 'user',
      ownerUserId: 'alice',
      analytics: null
    };
    apiMocks.listMock.mockResolvedValueOnce([base]);

    const { result } = renderHook(() => useSavedEventViews());

    await waitFor(() => expect(result.current.savedViews).toHaveLength(1));

    const appliedRecord: EventSavedViewRecord = {
      ...base,
      appliedCount: 2,
      analytics: {
        windowSeconds: 900,
        totalEvents: 42,
        errorEvents: 5,
        eventRatePerMinute: 2.8,
        errorRatio: 5 / 42,
        generatedAt: '2025-01-02T00:00:00.000Z',
        sampledCount: 180,
        sampleLimit: 2000,
        truncated: false
      }
    };
    apiMocks.applyMock.mockResolvedValueOnce(appliedRecord);

    await act(async () => {
      await result.current.applySavedView(base.slug);
    });

    expect(result.current.savedViews[0].appliedCount).toBe(2);
    expect(result.current.savedViews[0].analytics?.totalEvents).toBe(42);
  });
});
