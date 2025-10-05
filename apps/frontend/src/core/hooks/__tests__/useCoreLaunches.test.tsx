import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCoreLaunches } from '../useCoreLaunches';
import type { AppRecord, LaunchRequestDraft, LaunchSummary } from '../../types';

const eventHandlers: Record<string, (event: unknown) => void> = {};
const mockAuthToken = 'token';
const mockListLaunches = vi.fn<
  Promise<LaunchSummary[]>,
  [string | null | undefined, string, { signal?: AbortSignal; limit?: number }?]
>();
const mockLaunchApp = vi.fn<
  Promise<{ repository?: AppRecord | null; launch?: LaunchSummary | null }>,
  [string | null | undefined, string, LaunchRequestDraft]
>();
const mockStopLaunch = vi.fn<
  Promise<{ repository?: AppRecord | null; launch?: LaunchSummary | null }>,
  [string | null | undefined, string, string]
>();

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ activeToken: mockAuthToken })
}));

vi.mock('../../api', () => ({
  listLaunches: (...args: unknown[]) => mockListLaunches(...args),
  launchApp: (...args: unknown[]) => mockLaunchApp(...args),
  stopLaunch: (...args: unknown[]) => mockStopLaunch(...args)
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

describe('useCoreLaunches', () => {
  beforeEach(() => {
    mockListLaunches.mockReset();
    mockLaunchApp.mockReset();
    mockStopLaunch.mockReset();
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

    mockListLaunches
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([refreshedLaunch]);
    mockLaunchApp.mockResolvedValueOnce({ repository: repositoryResult, launch: refreshedLaunch });

    const repositories = {
      replace: vi.fn(),
      update: vi.fn(),
      merge: vi.fn()
    };

    const { result } = renderHook(() => useCoreLaunches({ repositories }));

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

    expect(mockListLaunches).toHaveBeenCalledTimes(2);
    expect(mockLaunchApp).toHaveBeenCalledWith(mockAuthToken, 'app-1', {
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
    mockLaunchApp.mockRejectedValueOnce(new Error('launch exploded'));

    const repositories = {
      replace: vi.fn(),
      update: vi.fn(),
      merge: vi.fn()
    };

    const { result } = renderHook(() => useCoreLaunches({ repositories }));

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

    const { result } = renderHook(() => useCoreLaunches({ repositories }));

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
