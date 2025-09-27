import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCatalogLaunches } from '../useCatalogLaunches';
import type { AppRecord, LaunchRequestDraft, LaunchSummary } from '../../types';

const mockAuthorizedFetch = vi.fn<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>();

const eventHandlers: Record<string, (event: unknown) => void> = {};

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => mockAuthorizedFetch
}));

vi.mock('../../../events/context', async () => {
  const actual = await vi.importActual('../../../events/context');
  return {
    ...actual,
    useAppHubEvent: (types: string | string[], handler: (event: unknown) => void) => {
      const list = Array.isArray(types) ? types : [types];
      for (const type of list) {
        eventHandlers[type] = handler;
      }
    }
  };
});

const createResponse = (body: unknown, init?: { status?: number; ok?: boolean }) => ({
  ok: init?.ok ?? true,
  status: init?.status ?? 200,
  async json() {
    return body;
  }
}) as unknown as Response;

const baseRepository: AppRecord = {
  id: 'app-1',
  name: 'Demo',
  description: '',
  repoUrl: 'https://example.com/repo',
  dockerfilePath: 'Dockerfile',
  tags: [],
  updatedAt: new Date().toISOString(),
  ingestStatus: 'ready',
  ingestError: null,
  ingestAttempts: 0,
  latestBuild: null,
  latestLaunch: null,
  relevance: null,
  previewTiles: [],
  metadataStrategy: 'auto'
};

describe('useCatalogLaunches', () => {
  beforeEach(() => {
    mockAuthorizedFetch.mockReset();
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
  });

  it('launches apps, normalizes payload, and refreshes open lists', async () => {
    const repositoryResult = { ...baseRepository, latestLaunch: null };
    const refreshedLaunch: LaunchSummary = {
      id: 'launch-1',
      status: 'pending',
      buildId: 'build-1',
      instanceUrl: null,
      resourceProfile: null,
      env: [],
      command: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      stoppedAt: null,
      expiresAt: null,
      port: null
    };

    mockAuthorizedFetch
      .mockResolvedValueOnce(createResponse({ data: [] }))
      .mockResolvedValueOnce(createResponse({ data: { repository: repositoryResult } }))
      .mockResolvedValueOnce(createResponse({ data: [refreshedLaunch] }));

    const repositories = {
      replace: vi.fn(),
      update: vi.fn(),
      merge: vi.fn()
    };

    const { result } = renderHook(() => useCatalogLaunches({ repositories }));

    await act(async () => {
      await result.current.toggleLaunches('app-1');
    });

    await waitFor(() => {
      expect(result.current.launchLists['app-1']?.open).toBe(true);
    });

    const draft: LaunchRequestDraft = {
      env: [
        { key: 'FOO ', value: 'bar' },
        { key: '   ', value: 'ignore-me' }
      ],
      command: '  npm start  ',
      launchId: 'launch-123'
    };

    await act(async () => {
      await result.current.launchApp('app-1', draft);
    });

    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(3);
    const [, launchInit] = mockAuthorizedFetch.mock.calls[1];
    expect(launchInit?.method).toBe('POST');
    const body = JSON.parse((launchInit?.body as string) ?? '{}');
    expect(body).toEqual({
      env: [{ key: 'FOO', value: 'bar' }],
      command: 'npm start',
      launchId: 'launch-123'
    });

    expect(repositories.replace).toHaveBeenCalledWith(repositoryResult);

    await waitFor(() => {
      expect(result.current.launchErrors['app-1']).toBeNull();
    });

    await waitFor(() => {
      expect(result.current.launchingId).toBeNull();
    });
  });

  it('records failures from the launch workflow', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce(
      createResponse({ error: 'launch exploded' }, { ok: false, status: 500 })
    );

    const repositories = {
      replace: vi.fn(),
      update: vi.fn(),
      merge: vi.fn()
    };

    const { result } = renderHook(() => useCatalogLaunches({ repositories }));

    await act(async () => {
      await result.current.launchApp('app-1', { env: [], command: 'echo', launchId: 'abc' });
    });

    expect(result.current.launchErrors['app-1']).toBe('launch exploded');
    expect(repositories.replace).not.toHaveBeenCalled();
    expect(result.current.launchingId).toBeNull();
  });

  it('updates launch state based on socket events', () => {
    const repositories = {
      replace: vi.fn(),
      update: vi.fn(),
      merge: vi.fn()
    };

    const { result } = renderHook(() => useCatalogLaunches({ repositories }));

    const handler = eventHandlers['launch.updated'];
    if (!handler) {
      throw new Error('launch.updated handler not registered');
    }

    const failedLaunch: LaunchSummary = {
      id: 'launch-42',
      status: 'failed',
      buildId: 'build-7',
      instanceUrl: null,
      resourceProfile: null,
      env: [],
      command: null,
      errorMessage: 'process crashed',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T01:00:00.000Z',
      startedAt: null,
      stoppedAt: null,
      expiresAt: null,
      port: null
    };

    act(() => {
      handler({
        type: 'launch.updated',
        data: { repositoryId: 'app-1', launch: failedLaunch }
      });
    });

    expect(repositories.update).toHaveBeenCalledWith('app-1', expect.any(Function));
    expect(result.current.launchErrors['app-1']).toBe('process crashed');

    const runningLaunch: LaunchSummary = {
      ...failedLaunch,
      status: 'running',
      errorMessage: null,
      updatedAt: '2023-01-01T02:00:00.000Z'
    };

    act(() => {
      handler({
        type: 'launch.updated',
        data: { repositoryId: 'app-1', launch: runningLaunch }
      });
    });

    expect(result.current.launchErrors['app-1']).toBeNull();

    const [, updater] = repositories.update.mock.calls[0];
    const updatedApp = (updater as (app: AppRecord) => AppRecord)({ ...baseRepository, latestLaunch: null });
    expect(updatedApp.latestLaunch).toEqual(failedLaunch);
  });
});
