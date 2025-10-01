import { useCallback, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import { API_BASE_URL, BUILD_PAGE_SIZE } from '../constants';
import type { BuildListMeta, BuildSummary, BuildTimelineState } from '../types';
import { formatFetchError } from '../utils';
import type { CoreRepositoryMutators } from './useCoreSearch';

function createDefaultBuildTimelineState(): BuildTimelineState {
  return {
    open: false,
    loading: false,
    loadingMore: false,
    error: null,
    builds: [],
    meta: null,
    logs: {},
    retrying: {},
    creating: false,
    createError: null
  };
}

export type UseCoreBuildsOptions = {
  repositories: Pick<CoreRepositoryMutators, 'update'>;
};

export type UseCoreBuildsResult = {
  buildState: Record<string, BuildTimelineState>;
  toggleBuilds: (id: string) => Promise<void>;
  loadMoreBuilds: (id: string) => Promise<void>;
  toggleLogs: (appId: string, buildId: string) => Promise<void>;
  retryBuild: (appId: string, buildId: string) => Promise<void>;
  triggerBuild: (appId: string, options: { branch?: string; ref?: string }) => Promise<boolean>;
};

export function useCoreBuilds(options: UseCoreBuildsOptions): UseCoreBuildsResult {
  const { repositories } = options;
  const authorizedFetch = useAuthorizedFetch();
  const [buildState, setBuildState] = useState<Record<string, BuildTimelineState>>({});

  const fetchBuilds = useCallback(
    async (
      id: string,
      config: { offset?: number; append?: boolean; limit?: number } = {}
    ) => {
      const append = config.append ?? false;
      const limit = config.limit ?? BUILD_PAGE_SIZE;
      const offset = config.offset ?? (append ? buildState[id]?.builds.length ?? 0 : 0);

      setBuildState((prev) => {
        const current = prev[id] ?? createDefaultBuildTimelineState();
        return {
          ...prev,
          [id]: {
            ...current,
            open: true,
            loading: append ? current.loading : true,
            loadingMore: append,
            error: null
          }
        };
      });

      try {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (offset > 0) {
          params.set('offset', String(offset));
        }
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/builds?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Failed to load builds (${response.status})`);
        }

        const builds = Array.isArray(payload?.data) ? (payload.data as BuildSummary[]) : [];
        const meta = payload?.meta as BuildListMeta | undefined;

        setBuildState((prev) => {
          const current = prev[id] ?? createDefaultBuildTimelineState();
          const mergedBuilds = append ? [...current.builds, ...builds] : builds;
          return {
            ...prev,
            [id]: {
              ...current,
              open: true,
              loading: false,
              loadingMore: false,
              error: null,
              builds: mergedBuilds,
              meta: meta ?? null
            }
          };
        });
      } catch (err) {
        setBuildState((prev) => {
          const current = prev[id] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [id]: {
              ...current,
              open: true,
              loading: false,
              loadingMore: false,
              error: formatFetchError(err, 'Failed to load builds', API_BASE_URL)
            }
          };
        });
      }
    },
    [authorizedFetch, buildState]
  );

  const toggleBuilds = useCallback(
    async (id: string) => {
      const existing = buildState[id];
      const nextOpen = !(existing?.open ?? false);

      if (!nextOpen) {
        setBuildState((prev) => {
          const current = prev[id] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [id]: {
              ...current,
              open: false
            }
          };
        });
        return;
      }

      if (existing?.builds?.length) {
        setBuildState((prev) => {
          const current = prev[id] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [id]: {
              ...current,
              open: true
            }
          };
        });
        return;
      }

      await fetchBuilds(id);
    },
    [buildState, fetchBuilds]
  );

  const loadMoreBuilds = useCallback(
    async (id: string) => {
      const state = buildState[id];
      if (!state || state.loadingMore || !state.meta || !state.meta.hasMore) {
        return;
      }
      const nextOffset = state.meta.nextOffset ?? state.builds.length;
      await fetchBuilds(id, { offset: nextOffset, append: true });
    },
    [buildState, fetchBuilds]
  );

  const fetchBuildLogs = useCallback(
    async (appId: string, buildId: string) => {
      setBuildState((prev) => {
        const current = prev[appId] ?? createDefaultBuildTimelineState();
        const existingLog = current.logs[buildId];
        return {
          ...prev,
          [appId]: {
            ...current,
            logs: {
              ...current.logs,
              [buildId]: {
                open: true,
                loading: true,
                error: null,
                content: existingLog?.content ?? null,
                size: existingLog?.size ?? 0,
                updatedAt: existingLog?.updatedAt ?? null
              }
            }
          }
        };
      });

      try {
        const response = await authorizedFetch(`${API_BASE_URL}/builds/${buildId}/logs`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Failed to load logs (${response.status})`);
        }

        const data = payload?.data as
          | { logs?: string; size?: number; updatedAt?: string | null }
          | undefined;
        const logs = typeof data?.logs === 'string' ? data.logs : '';
        const size = typeof data?.size === 'number' ? data.size : logs.length;
        const updatedAt = data?.updatedAt ?? null;

        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [appId]: {
              ...current,
              logs: {
                ...current.logs,
                [buildId]: {
                  open: true,
                  loading: false,
                  error: null,
                  content: logs,
                  size,
                  updatedAt
                }
              }
            }
          };
        });
      } catch (err) {
        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          const existingLog = current.logs[buildId];
          return {
            ...prev,
            [appId]: {
              ...current,
              logs: {
                ...current.logs,
                [buildId]: {
                  open: true,
                  loading: false,
                  error: formatFetchError(err, 'Failed to load logs', API_BASE_URL),
                  content: existingLog?.content ?? null,
                  size: existingLog?.size ?? 0,
                  updatedAt: existingLog?.updatedAt ?? null
                }
              }
            }
          };
        });
      }
    },
    [authorizedFetch]
  );

  const toggleLogs = useCallback(
    async (appId: string, buildId: string) => {
      const state = buildState[appId] ?? createDefaultBuildTimelineState();
      const logEntry = state.logs[buildId];
      const nextOpen = !(logEntry?.open ?? false);

      if (!nextOpen) {
        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          const currentLog = current.logs[buildId];
          return {
            ...prev,
            [appId]: {
              ...current,
              logs: {
                ...current.logs,
                [buildId]: currentLog
                  ? { ...currentLog, open: false }
                  : { open: false, loading: false, error: null, content: null, size: 0, updatedAt: null }
              }
            }
          };
        });
        return;
      }

      if (logEntry?.content && !logEntry.error) {
        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          const currentLog = current.logs[buildId];
          return {
            ...prev,
            [appId]: {
              ...current,
              logs: {
                ...current.logs,
                [buildId]: currentLog ? { ...currentLog, open: true } : currentLog
              }
            }
          };
        });
        return;
      }

      await fetchBuildLogs(appId, buildId);
    },
    [buildState, fetchBuildLogs]
  );

  const retryBuild = useCallback(
    async (appId: string, buildId: string) => {
      setBuildState((prev) => {
        const current = prev[appId] ?? createDefaultBuildTimelineState();
        return {
          ...prev,
          [appId]: {
            ...current,
            error: null,
            retrying: { ...current.retrying, [buildId]: true }
          }
        };
      });

      try {
        const response = await authorizedFetch(`${API_BASE_URL}/builds/${buildId}/retry`, {
          method: 'POST'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Failed to retry build (${response.status})`);
        }

        const newBuild = payload?.data as BuildSummary | undefined;
        if (newBuild) {
          repositories.update(appId, (app) => ({ ...app, latestBuild: newBuild }));
        }

        await fetchBuilds(appId);
      } catch (err) {
        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [appId]: {
              ...current,
              retrying: { ...current.retrying, [buildId]: false },
              error: formatFetchError(err, 'Failed to retry build', API_BASE_URL)
            }
          };
        });
        return;
      }

      setBuildState((prev) => {
        const current = prev[appId] ?? createDefaultBuildTimelineState();
        return {
          ...prev,
          [appId]: {
            ...current,
            retrying: { ...current.retrying, [buildId]: false }
          }
        };
      });
    },
    [authorizedFetch, fetchBuilds, repositories]
  );

  const triggerBuild = useCallback(
    async (appId: string, options: { branch?: string; ref?: string } = {}) => {
      setBuildState((prev) => {
        const current = prev[appId] ?? createDefaultBuildTimelineState();
        return {
          ...prev,
          [appId]: {
            ...current,
            creating: true,
            createError: null
          }
        };
      });

      try {
        const body: Record<string, string> = {};
        if (options.branch) {
          body.branch = options.branch;
        }
        if (options.ref) {
          body.ref = options.ref;
        }
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${appId}/builds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Failed to trigger build (${response.status})`);
        }

        const newBuild = payload?.data as BuildSummary | undefined;
        if (newBuild) {
          repositories.update(appId, (app) => ({ ...app, latestBuild: newBuild }));
        }

        await fetchBuilds(appId);

        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [appId]: {
              ...current,
              creating: false,
              createError: null
            }
          };
        });

        return true;
      } catch (err) {
        setBuildState((prev) => {
          const current = prev[appId] ?? createDefaultBuildTimelineState();
          return {
            ...prev,
            [appId]: {
              ...current,
              creating: false,
              createError: formatFetchError(err, 'Failed to trigger build', API_BASE_URL)
            }
          };
        });
        return false;
      }
    },
    [authorizedFetch, fetchBuilds, repositories]
  );

  const handleBuildUpdate = useCallback((build: BuildSummary) => {
    repositories.update(build.repositoryId, (app) =>
      app.id === build.repositoryId && app.latestBuild?.id === build.id
        ? { ...app, latestBuild: build }
        : app
    );

    setBuildState((prev) => {
      const current = prev[build.repositoryId];
      if (!current) {
        return prev;
      }
      const existingIndex = current.builds.findIndex((item) => item.id === build.id);
      const merged = existingIndex === -1
        ? [build, ...current.builds]
        : current.builds.map((item, idx) => (idx === existingIndex ? build : item));

      const limit = current.meta?.limit ?? BUILD_PAGE_SIZE;
      const trimmed = merged.slice(0, limit);

      const nextMeta = current.meta
        ? {
            ...current.meta,
            total: current.meta.total + (existingIndex === -1 ? 1 : 0),
            count: trimmed.length,
            hasMore: current.meta.hasMore || merged.length > trimmed.length
          }
        : current.meta;

      return {
        ...prev,
        [build.repositoryId]: {
          ...current,
          builds: trimmed,
          meta: nextMeta ?? null
        }
      };
    });
  }, [repositories]);

  const handleBuildSocketEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: 'build.updated' }>) => {
      if (event.data?.build) {
        handleBuildUpdate(event.data.build);
      }
    },
    [handleBuildUpdate]
  );

  useAppHubEvent('build.updated', handleBuildSocketEvent);

  return {
    buildState,
    toggleBuilds,
    loadMoreBuilds,
    toggleLogs,
    retryBuild,
    triggerBuild
  };
}
