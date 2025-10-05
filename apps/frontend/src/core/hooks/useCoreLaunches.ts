import { useCallback, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import { API_BASE_URL } from '../constants';
import type { LaunchListState, LaunchRequestDraft, LaunchSummary } from '../types';
import { formatFetchError } from '../utils';
import type { CoreRepositoryMutators } from './useCoreSearch';
import { launchApp as launchAppRequest, listLaunches, stopLaunch as stopLaunchRequest } from '../api';

export type UseCoreLaunchesOptions = {
  repositories: CoreRepositoryMutators;
};

export type UseCoreLaunchesResult = {
  launchLists: LaunchListState;
  launchErrors: Record<string, string | null>;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  toggleLaunches: (id: string) => Promise<void>;
  launchApp: (id: string, draft: LaunchRequestDraft) => Promise<void>;
  stopLaunch: (appId: string, launchId: string) => Promise<void>;
};

export function useCoreLaunches(options: UseCoreLaunchesOptions): UseCoreLaunchesResult {
  const { repositories } = options;
  const { activeToken: authToken } = useAuth();
  const [launchLists, setLaunchLists] = useState<LaunchListState>({});
  const [launchErrors, setLaunchErrors] = useState<Record<string, string | null>>({});
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [stoppingLaunchId, setStoppingLaunchId] = useState<string | null>(null);

  const fetchLaunches = useCallback(
    async (id: string, force = false) => {
      setLaunchLists((prev) => ({
        ...prev,
        [id]: {
          open: true,
          loading: true,
          error: null,
          launches: force ? null : prev[id]?.launches ?? null
        }
      }));

      try {
        const payload = await listLaunches(authToken, id);
        setLaunchLists((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: null,
            launches: payload ?? []
          }
        }));
      } catch (err) {
        setLaunchLists((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: formatFetchError(err, 'Failed to load launches', API_BASE_URL),
            launches: null
          }
        }));
      }
    },
    [authToken]
  );

  const toggleLaunches = useCallback(
    async (id: string) => {
      const existing = launchLists[id];
      const nextOpen = !(existing?.open ?? false);

      if (!nextOpen) {
        setLaunchLists((prev) => ({
          ...prev,
          [id]: {
            open: false,
            loading: false,
            error: existing?.error ?? null,
            launches: existing?.launches ?? null
          }
        }));
        return;
      }

      if (existing?.launches) {
        setLaunchLists((prev) => ({
          ...prev,
          [id]: {
            ...existing,
            open: true,
            loading: false,
            error: null
          }
        }));
        return;
      }

      await fetchLaunches(id);
    },
    [fetchLaunches, launchLists]
  );

  const launchApp = useCallback(
    async (id: string, request: LaunchRequestDraft) => {
      setLaunchingId(id);
      setLaunchErrors((prev) => ({ ...prev, [id]: null }));
      try {
        const normalizedEnv = request.env
          .map((entry) => ({ key: entry.key.trim(), value: entry.value }))
          .filter((entry) => entry.key.length > 0);
        const commandInput = request.command ?? '';
        const command = commandInput.trim();
        const payload = await launchAppRequest(authToken, id, {
          env: normalizedEnv,
          command: command.length > 0 ? command : undefined,
          launchId: request.launchId
        });
        const repository = payload.repository ?? undefined;
        if (repository) {
          repositories.replace(repository);
        }
        if (launchLists[id]?.open) {
          await fetchLaunches(id, true);
        }
        setLaunchErrors((prev) => ({ ...prev, [id]: null }));
      } catch (err) {
        setLaunchErrors((prev) => ({
          ...prev,
          [id]: formatFetchError(err, 'Failed to launch app', API_BASE_URL)
        }));
      } finally {
        setLaunchingId(null);
      }
    },
    [authToken, fetchLaunches, launchLists, repositories]
  );

  const stopLaunch = useCallback(
    async (appId: string, launchId: string) => {
      setStoppingLaunchId(launchId);
      setLaunchErrors((prev) => ({ ...prev, [appId]: null }));
      try {
        const payload = await stopLaunchRequest(authToken, appId, launchId);
        const repository = payload.repository ?? undefined;
        if (repository) {
          repositories.replace(repository);
        }
        if (launchLists[appId]?.open) {
          await fetchLaunches(appId, true);
        }
        setLaunchErrors((prev) => ({ ...prev, [appId]: null }));
      } catch (err) {
        setLaunchErrors((prev) => ({
          ...prev,
          [appId]: formatFetchError(err, 'Failed to stop launch', API_BASE_URL)
        }));
      } finally {
        setStoppingLaunchId(null);
      }
    },
    [authToken, fetchLaunches, launchLists, repositories]
  );

  const handleLaunchUpdate = useCallback((repositoryId: string, launch: LaunchSummary) => {
    repositories.update(repositoryId, (app) => {
      if (!app.latestLaunch || app.latestLaunch.id === launch.id) {
        return { ...app, latestLaunch: launch };
      }
      const currentTimestamp = Date.parse(app.latestLaunch.updatedAt ?? app.latestLaunch.createdAt);
      const nextTimestamp = Date.parse(launch.updatedAt ?? launch.createdAt);
      if (
        !Number.isFinite(currentTimestamp) ||
        !Number.isFinite(nextTimestamp) ||
        nextTimestamp >= currentTimestamp
      ) {
        return { ...app, latestLaunch: launch };
      }
      return app;
    });

    setLaunchLists((prev) => {
      const current = prev[repositoryId];
      if (!current || !current.launches) {
        return prev;
      }
      const index = current.launches.findIndex((item) => item.id === launch.id);
      const launches = index === -1
        ? [launch, ...current.launches]
        : current.launches.map((item, idx) => (idx === index ? launch : item));
      return {
        ...prev,
        [repositoryId]: {
          ...current,
          launches
        }
      };
    });

    setLaunchErrors((prev) => {
      const currentError = prev[repositoryId] ?? null;
      if (launch.status === 'failed') {
        const nextMessage = launch.errorMessage ?? 'Launch failed';
        if (currentError === nextMessage) {
          return prev;
        }
        return { ...prev, [repositoryId]: nextMessage };
      }
      if (currentError === null || currentError === undefined) {
        return prev;
      }
      const next = { ...prev };
      next[repositoryId] = null;
      return next;
    });
  }, [repositories]);

  const handleLaunchSocketEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: 'launch.updated' }>) => {
      if (event.data?.launch && event.data.repositoryId) {
        handleLaunchUpdate(event.data.repositoryId, event.data.launch);
      }
    },
    [handleLaunchUpdate]
  );

  useAppHubEvent('launch.updated', handleLaunchSocketEvent);

  return {
    launchLists,
    launchErrors,
    launchingId,
    stoppingLaunchId,
    toggleLaunches,
    launchApp,
    stopLaunch
  };
}
