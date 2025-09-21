import { useCallback, useEffect, useMemo, useState, type KeyboardEventHandler } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { API_BASE_URL, BUILD_PAGE_SIZE, INGEST_STATUSES } from './constants';
import type {
  AppRecord,
  BuildListMeta,
  BuildSummary,
  BuildTimelineState,
  CatalogSocketEvent,
  HistoryState,
  IngestionEvent,
  LaunchListState,
  LaunchRequestDraft,
  LaunchSummary,
  SearchMeta,
  SearchParseResult,
  SearchSort,
  StatusFacet,
  TagFacet,
  TagSuggestion
} from './types';
import {
  applySuggestionToInput,
  computeAutocompleteContext,
  formatFetchError,
  parseSearchInput
} from './utils';

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

export type UseCatalogResult = {
  inputValue: string;
  setInputValue: (value: string) => void;
  apps: AppRecord[];
  loading: boolean;
  error: string | null;
  suggestions: TagSuggestion[];
  highlightIndex: number;
  parsedQuery: SearchParseResult;
  statusFilters: AppRecord['ingestStatus'][];
  tagFacets: TagFacet[];
  statusFacets: StatusFacet[];
  ownerFacets: TagFacet[];
  frameworkFacets: TagFacet[];
  searchMeta: SearchMeta | null;
  sortMode: SearchSort;
  showHighlights: boolean;
  activeTokens: string[];
  highlightEnabled: boolean;
  historyState: HistoryState;
  buildState: Record<string, BuildTimelineState>;
  launchLists: LaunchListState;
  launchErrors: Record<string, string | null>;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  retryingId: string | null;
  handlers: {
    handleKeyDown: KeyboardEventHandler<HTMLInputElement>;
    applySuggestion: (suggestion: TagSuggestion) => void;
    toggleStatus: (status: AppRecord['ingestStatus']) => void;
    clearStatusFilters: () => void;
    applyTagFacet: (facet: TagFacet) => void;
    setSortMode: (sort: SearchSort) => void;
    toggleHighlights: (enabled: boolean) => void;
    retryIngestion: (id: string) => Promise<void>;
    toggleHistory: (id: string) => Promise<void>;
    toggleBuilds: (id: string) => Promise<void>;
    loadMoreBuilds: (id: string) => Promise<void>;
    toggleLogs: (appId: string, buildId: string) => Promise<void>;
    retryBuild: (appId: string, buildId: string) => Promise<void>;
    triggerBuild: (appId: string, options: { branch?: string; ref?: string }) => Promise<boolean>;
    toggleLaunches: (id: string) => Promise<void>;
    launchApp: (id: string, draft: LaunchRequestDraft) => Promise<void>;
    stopLaunch: (appId: string, launchId: string) => Promise<void>;
  };
};

export function useCatalog(): UseCatalogResult {
  const [inputValue, setInputValue] = useState('');
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<HistoryState>({});
  const [buildState, setBuildState] = useState<Record<string, BuildTimelineState>>({});
  const [launchLists, setLaunchLists] = useState<LaunchListState>({});
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [stoppingLaunchId, setStoppingLaunchId] = useState<string | null>(null);
  const [launchErrors, setLaunchErrors] = useState<Record<string, string | null>>({});
  const [statusFilters, setStatusFilters] = useState<AppRecord['ingestStatus'][]>([]);
  const [tagFacets, setTagFacets] = useState<TagFacet[]>([]);
  const [statusFacets, setStatusFacets] = useState<StatusFacet[]>(() =>
    INGEST_STATUSES.map((status) => ({ status, count: 0 }))
  );
  const [ownerFacets, setOwnerFacets] = useState<TagFacet[]>([]);
  const [frameworkFacets, setFrameworkFacets] = useState<TagFacet[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [sortMode, setSortModeInternal] = useState<SearchSort>('relevance');
  const [sortManuallySet, setSortManuallySet] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const authorizedFetch = useAuthorizedFetch();

  const autocompleteContext = useMemo(() => computeAutocompleteContext(inputValue), [inputValue]);
  const parsedQuery = useMemo(() => parseSearchInput(inputValue), [inputValue]);
  const statusSignature = useMemo(
    () => statusFilters.slice().sort().join(','),
    [statusFilters]
  );
  const searchSignature = useMemo(
    () =>
      [
        parsedQuery.text,
        parsedQuery.tags.join(','),
        statusSignature,
        sortMode
      ].join('|'),
    [parsedQuery.text, parsedQuery.tags, statusSignature, sortMode]
  );
  const activeTokens = useMemo(() => searchMeta?.tokens ?? [], [searchMeta]);
  const highlightEnabled = showHighlights && activeTokens.length > 0;

  useEffect(() => {
    if (!parsedQuery.text) {
      setSortManuallySet(false);
    }
    if (parsedQuery.text && !sortManuallySet && sortMode !== 'relevance') {
      setSortModeInternal('relevance');
    }
    if (!parsedQuery.text && !sortManuallySet && sortMode !== 'updated') {
      setSortModeInternal('updated');
    }
  }, [parsedQuery.text, sortMode, sortManuallySet]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (parsedQuery.text) {
          params.set('q', parsedQuery.text);
        }
        if (parsedQuery.tags.length > 0) {
          params.set('tags', parsedQuery.tags.join(' '));
        }
        if (statusFilters.length > 0) {
          params.set('status', statusFilters.join(','));
        }
        params.set('sort', sortMode);
        const response = await authorizedFetch(`${API_BASE_URL}/apps?${params.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Search failed with status ${response.status}`);
        }
        const payload = await response.json();
        setApps(payload.data ?? []);
        setTagFacets(payload.facets?.tags ?? []);
        setStatusFacets(() => {
          const rawStatuses = (payload.facets?.statuses ?? []) as StatusFacet[];
          const counts = new Map(rawStatuses.map((item) => [item.status, item.count]));
          return INGEST_STATUSES.map((status) => ({
            status,
            count: counts.get(status) ?? 0
          }));
        });
        setOwnerFacets(payload.facets?.owners ?? []);
        setFrameworkFacets(payload.facets?.frameworks ?? []);
        setSearchMeta(payload.meta ?? null);
        if (payload.meta?.sort && payload.meta.sort !== sortMode) {
          setSortModeInternal(payload.meta.sort);
          setSortManuallySet(false);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [authorizedFetch, searchSignature, parsedQuery, statusFilters, sortMode]);

  useEffect(() => {
    const controller = new AbortController();
    const { activeToken } = autocompleteContext;
    if (!activeToken) {
      setSuggestions([]);
      setHighlightIndex(0);
      return () => {
        controller.abort();
      };
    }

    const timeoutId = setTimeout(async () => {
      try {
        const response = await authorizedFetch(
          `${API_BASE_URL}/tags/suggest?prefix=${encodeURIComponent(activeToken)}&limit=12`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error('Failed to fetch tag suggestions');
        }
        const payload = await response.json();
        setSuggestions(payload.data ?? []);
        setHighlightIndex(0);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [autocompleteContext, authorizedFetch]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setHighlightIndex(0);
    } else {
      setHighlightIndex((current) => Math.min(current, suggestions.length - 1));
    }
  }, [suggestions]);

  const applySuggestion = useCallback((suggestion: TagSuggestion) => {
    setInputValue((prev) => applySuggestionToInput(prev, suggestion));
    setSuggestions([]);
  }, []);

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (suggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setHighlightIndex((idx) => (idx + 1) % suggestions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setHighlightIndex((idx) => (idx - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          applySuggestion(suggestions[highlightIndex]);
          return;
        }
        if (event.key === 'Enter') {
          if (suggestions[highlightIndex]) {
            event.preventDefault();
            applySuggestion(suggestions[highlightIndex]);
            return;
          }
        }
      }

      if (event.key === 'Escape') {
        setSuggestions([]);
      }
    },
    [applySuggestion, highlightIndex, suggestions]
  );

  const toggleStatus = useCallback((status: AppRecord['ingestStatus']) => {
    setStatusFilters((current) => {
      if (current.includes(status)) {
        return current.filter((item) => item !== status);
      }
      return [...current, status];
    });
  }, []);

  const applyTagFacet = useCallback((facet: TagFacet) => {
    const token = `${facet.key}:${facet.value}`;
    setInputValue((prev) => {
      const { tags } = parseSearchInput(prev);
      if (tags.includes(token)) {
        return prev;
      }
      const needsSpace = prev.length > 0 && !/\s$/.test(prev);
      return `${prev}${needsSpace ? ' ' : ''}${token} `;
    });
    setSuggestions([]);
  }, []);

  const clearStatusFilters = useCallback(() => {
    setStatusFilters([]);
  }, []);

  const setSortMode = useCallback((next: SearchSort) => {
    setSortModeInternal(next);
    setSortManuallySet(true);
  }, []);

  const toggleHighlights = useCallback((enabled: boolean) => {
    setShowHighlights(enabled);
  }, []);

  const fetchHistory = useCallback(
    async (id: string, force = false) => {
      setHistoryState((prev) => ({
        ...prev,
        [id]: {
          open: true,
          loading: true,
          error: null,
          events: force ? null : prev[id]?.events ?? null
        }
      }));

      try {
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/history`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? `Failed to load history (${response.status})`);
        }
        const payload = await response.json();
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: null,
            events: payload?.data ?? []
          }
        }));
      } catch (err) {
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: (err as Error).message,
            events: null
          }
        }));
      }
    },
    [authorizedFetch]
  );

  const toggleHistory = useCallback(
    async (id: string) => {
      const existing = historyState[id];
      const nextOpen = !(existing?.open ?? false);

      if (!nextOpen) {
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: false,
            loading: false,
            error: existing?.error ?? null,
            events: existing?.events ?? null
          }
        }));
        return;
      }

      if (existing?.events) {
        setHistoryState((prev) => ({
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

      await fetchHistory(id);
    },
    [fetchHistory, historyState]
  );

  const fetchBuilds = useCallback(
    async (
      id: string,
      options: { offset?: number; append?: boolean; limit?: number } = {}
    ) => {
      const append = options.append ?? false;
      const limit = options.limit ?? BUILD_PAGE_SIZE;
      const offset = options.offset ?? (append ? buildState[id]?.builds.length ?? 0 : 0);

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
              meta:
                meta ?? {
                  total: mergedBuilds.length,
                  count: mergedBuilds.length,
                  limit,
                  offset,
                  nextOffset: null,
                  hasMore: false
                },
              logs: { ...current.logs },
              retrying: { ...current.retrying }
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
      const state = buildState[id];
      const nextOpen = !(state?.open ?? false);

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

      if (!state || state.builds.length === 0 || state.error) {
        await fetchBuilds(id);
        return;
      }

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
          setApps((prev) =>
            prev.map((app) => (app.id === appId ? { ...app, latestBuild: newBuild } : app))
          );
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
      [authorizedFetch, fetchBuilds]
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
          setApps((prev) =>
            prev.map((app) => (app.id === appId ? { ...app, latestBuild: newBuild } : app))
          );
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
    [authorizedFetch, fetchBuilds]
  );

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
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/launches`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? `Failed to load launches (${response.status})`);
        }
        const payload = await response.json();
        setLaunchLists((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: null,
            launches: payload?.data ?? []
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
    [authorizedFetch]
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
        const requestPayload: Record<string, unknown> = {};
        if (normalizedEnv.length > 0) {
          requestPayload.env = normalizedEnv;
        }
        const command = request.command.trim();
        if (command.length > 0) {
          requestPayload.command = command;
        }
        if (request.launchId) {
          requestPayload.launchId = request.launchId;
        }
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/launch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Launch failed with status ${response.status}`);
        }
        if (payload?.data?.repository) {
          setApps((prev) =>
            prev.map((app) => (app.id === id ? (payload.data.repository as AppRecord) : app))
          );
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
    [authorizedFetch, fetchLaunches, launchLists]
  );

  const stopLaunch = useCallback(
    async (appId: string, launchId: string) => {
      setStoppingLaunchId(launchId);
      setLaunchErrors((prev) => ({ ...prev, [appId]: null }));
      try {
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${appId}/launches/${launchId}/stop`, {
          method: 'POST'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Stop failed with status ${response.status}`);
        }
        if (payload?.data?.repository) {
          setApps((prev) =>
            prev.map((app) => (app.id === appId ? (payload.data.repository as AppRecord) : app))
          );
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
    [authorizedFetch, fetchLaunches, launchLists]
  );

  const retryIngestion = useCallback(
    async (id: string) => {
      setRetryingId(id);
      try {
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/retry`, {
          method: 'POST'
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? `Retry failed with status ${response.status}`);
        }
        if (payload?.data) {
          setApps((prev) => prev.map((app) => (app.id === id ? { ...app, ...payload.data } : app)));
          if (historyState[id]?.open) {
            await fetchHistory(id, true);
          }
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRetryingId(null);
      }
    },
    [authorizedFetch, fetchHistory, historyState]
  );

  const handleRepositoryUpdate = useCallback((repository: AppRecord) => {
    setApps((prev) => {
      const index = prev.findIndex((item) => item.id === repository.id);
      if (index === -1) {
        return prev;
      }
      const next = prev.slice();
      next[index] = repository;
      return next;
    });
  }, []);

  const handleIngestionEvent = useCallback((event: IngestionEvent) => {
    setHistoryState((prev) => {
      const current = prev[event.repositoryId];
      if (!current) {
        return prev;
      }
      const existingEvents = current.events ?? [];
      const eventIndex = existingEvents.findIndex((item) => item.id === event.id);
      const nextEvents = eventIndex === -1
        ? [event, ...existingEvents]
        : existingEvents.map((item, idx) => (idx === eventIndex ? event : item));
      return {
        ...prev,
        [event.repositoryId]: {
          ...current,
          events: nextEvents
        }
      };
    });
  }, []);

  const handleBuildUpdate = useCallback((build: BuildSummary) => {
    setApps((prev) =>
      prev.map((app) => (app.id === build.repositoryId && app.latestBuild?.id === build.id
        ? { ...app, latestBuild: build }
        : app))
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
  }, []);

  const handleLaunchUpdate = useCallback((repositoryId: string, launch: LaunchSummary) => {
    setApps((prev) =>
      prev.map((app) => {
        if (app.id !== repositoryId) {
          return app;
        }
        if (!app.latestLaunch || app.latestLaunch.id === launch.id) {
          return { ...app, latestLaunch: launch };
        }
        const currentTimestamp = Date.parse(app.latestLaunch.updatedAt ?? app.latestLaunch.createdAt);
        const nextTimestamp = Date.parse(launch.updatedAt ?? launch.createdAt);
        if (!Number.isFinite(currentTimestamp) || !Number.isFinite(nextTimestamp) || nextTimestamp >= currentTimestamp) {
          return { ...app, latestLaunch: launch };
        }
        return app;
      })
    );

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
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    const resolveWebsocketUrl = () => {
      try {
        const apiUrl = new URL(API_BASE_URL);
        const wsUrl = new URL(apiUrl.toString());
        wsUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl.hash = '';
        wsUrl.search = '';
        wsUrl.pathname = `${apiUrl.pathname.replace(/\/$/, '')}/ws`;
        return wsUrl.toString();
      } catch {
        const sanitized = API_BASE_URL.replace(/^https?:\/\//, '');
        const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
        return `${protocol}${sanitized.replace(/\/$/, '')}/ws`;
      }
    };

    const connect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const url = resolveWebsocketUrl();
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        const envelope = payload as CatalogSocketEvent;

        switch (envelope.type) {
          case 'connection.ack':
          case 'pong':
            return;
          case 'repository.updated':
            if (envelope.data?.repository) {
              handleRepositoryUpdate(envelope.data.repository);
            }
            return;
          case 'repository.ingestion-event':
            if (envelope.data?.event) {
              handleIngestionEvent(envelope.data.event);
            }
            return;
          case 'build.updated':
            if (envelope.data?.build) {
              handleBuildUpdate(envelope.data.build);
            }
            return;
          case 'launch.updated':
            if (envelope.data?.launch && envelope.data?.repositoryId) {
              handleLaunchUpdate(envelope.data.repositoryId, envelope.data.launch);
            }
            return;
          default:
            return;
        }
      };

      const scheduleReconnect = (delay: number) => {
        if (closed) {
          return;
        }
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onclose = () => {
        if (closed) {
          return;
        }
        attempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** attempt);
        scheduleReconnect(delay);
        socket = null;
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [handleRepositoryUpdate, handleIngestionEvent, handleBuildUpdate, handleLaunchUpdate]);

  return {
    inputValue,
    setInputValue,
    apps,
    loading,
    error,
    suggestions,
    highlightIndex,
    parsedQuery,
    statusFilters,
    tagFacets,
    statusFacets,
    ownerFacets,
    frameworkFacets,
    searchMeta,
    sortMode,
    showHighlights,
    activeTokens,
    highlightEnabled,
    historyState,
    buildState,
    launchLists,
    launchErrors,
    launchingId,
    stoppingLaunchId,
    retryingId,
    handlers: {
      handleKeyDown,
      applySuggestion,
      toggleStatus,
      clearStatusFilters,
      applyTagFacet,
      setSortMode,
      toggleHighlights,
      retryIngestion,
      toggleHistory,
      toggleBuilds,
      loadMoreBuilds,
      toggleLogs,
      retryBuild,
      triggerBuild,
      toggleLaunches,
      launchApp,
      stopLaunch
    }
  };
}
