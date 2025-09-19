import { Fragment, useEffect, useMemo, useState, type KeyboardEventHandler } from 'react';
import './App.css';
import SubmitApp from './SubmitApp';

type TagKV = {
  key: string;
  value: string;
};

type BuildSummary = {
  id: string;
  repositoryId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  imageTag: string | null;
  errorMessage: string | null;
  commitSha: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  logsPreview: string | null;
  logsTruncated: boolean;
  hasLogs: boolean;
  logsSize: number;
};

type LaunchSummary = {
  id: string;
  status: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  buildId: string;
  instanceUrl: string | null;
  resourceProfile: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
  port: number | null;
};

type BuildListMeta = {
  total: number;
  count: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
};

type BuildLogState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  content: string | null;
  size: number;
  updatedAt: string | null;
};

type BuildTimelineState = {
  open: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  builds: BuildSummary[];
  meta: BuildListMeta | null;
  logs: Record<string, BuildLogState>;
  retrying: Record<string, boolean>;
};

type AppRecord = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  tags: TagKV[];
  updatedAt: string;
  ingestStatus: 'seed' | 'pending' | 'processing' | 'ready' | 'failed';
  ingestError: string | null;
  ingestAttempts: number;
  latestBuild: BuildSummary | null;
  latestLaunch: LaunchSummary | null;
  relevance: RelevanceSummary | null;
};

type RelevanceComponent = {
  hits: number;
  weight: number;
  score: number;
};

type RelevanceSummary = {
  score: number;
  normalizedScore: number;
  components: {
    name: RelevanceComponent;
    description: RelevanceComponent;
    tags: RelevanceComponent;
  };
};

type TagSuggestion = {
  type: 'key' | 'pair';
  value: string;
  label: string;
};

type TagFacet = {
  key: string;
  value: string;
  count: number;
};

type StatusFacet = {
  status: AppRecord['ingestStatus'];
  count: number;
};

const INGEST_STATUSES: AppRecord['ingestStatus'][] = ['seed', 'pending', 'processing', 'ready', 'failed'];

type SearchMeta = {
  tokens: string[];
  sort: 'relevance' | 'updated' | 'name';
  weights: {
    name: number;
    description: number;
    tags: number;
  };
};

type IngestionEvent = {
  id: number;
  status: string;
  message: string | null;
  attempt: number | null;
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
};

type HistoryState = Record<
  string,
  {
    open: boolean;
    loading: boolean;
    error: string | null;
    events: IngestionEvent[] | null;
  }
>;

type LaunchListState = Record<
  string,
  {
    open: boolean;
    loading: boolean;
    error: string | null;
    launches: LaunchSummary[] | null;
  }
>;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const BUILD_PAGE_SIZE = 5;

function formatFetchError(err: unknown, fallback: string) {
  if (err instanceof Error) {
    const message = err.message ?? '';
    const lower = message.toLowerCase();
    const looksLikeNetworkIssue =
      err.name === 'TypeError' ||
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('fetch failed') ||
      lower.includes('load failed');

    if (looksLikeNetworkIssue) {
      const base = API_BASE_URL.replace(/\/$/, '');
      return `${fallback}. Unable to reach the catalog API at ${base}. Start the API server (npm run dev:api) or set VITE_API_BASE_URL.`;
    }

    return message || fallback;
  }

  return fallback;
}

function parseSearchInput(input: string) {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const tags: string[] = [];
  const textTokens: string[] = [];

  for (const token of tokens) {
    if (token.includes(':')) {
      tags.push(token);
    } else {
      textTokens.push(token);
    }
  }

  return {
    tags,
    text: textTokens.join(' ')
  };
}

function computeAutocompleteContext(input: string) {
  if (!input) {
    return { base: '', activeToken: '' };
  }

  const match = input.match(/^(.*?)([^\s]*)$/);
  if (!match) {
    return { base: input, activeToken: '' };
  }
  const [, basePart, token] = match;
  return { base: basePart, activeToken: token };
}

function createDefaultBuildTimelineState(): BuildTimelineState {
  return {
    open: false,
    loading: false,
    loadingMore: false,
    error: null,
    builds: [],
    meta: null,
    logs: {},
    retrying: {}
  };
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || Number.isNaN(durationMs)) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.max(durationMs, 0)} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  const secondsPart = remainingSeconds > 0 ? `${remainingSeconds}s` : '';
  return `${minutes}m${secondsPart ? ` ${secondsPart}` : ''}`;
}

function formatBytes(size: number) {
  if (!size || Number.isNaN(size)) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function escapeRegexToken(token: string) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSegments(text: string, tokens: string[], enabled: boolean) {
  if (!enabled || tokens.length === 0) {
    return text;
  }
  const escaped = tokens.map(escapeRegexToken).filter(Boolean);
  if (escaped.length === 0) {
    return text;
  }
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const segments = text.split(regex);
  const tokenSet = new Set(tokens.map((token) => token.toLowerCase()));
  return segments.map((segment, index) => {
    if (!segment) {
      return null;
    }
    const lower = segment.toLowerCase();
    if (tokenSet.has(lower)) {
      return (
        <mark key={`match-${index}`}>{segment}</mark>
      );
    }
    return (
      <Fragment key={`text-${index}`}>{segment}</Fragment>
    );
  });
}

function App() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'submit'>('catalog');
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
  const [ingestedAfter, setIngestedAfter] = useState('');
  const [ingestedBefore, setIngestedBefore] = useState('');
  const [tagFacets, setTagFacets] = useState<TagFacet[]>([]);
  const [statusFacets, setStatusFacets] = useState<StatusFacet[]>(() =>
    INGEST_STATUSES.map((status) => ({ status, count: 0 }))
  );
  const [ownerFacets, setOwnerFacets] = useState<TagFacet[]>([]);
  const [frameworkFacets, setFrameworkFacets] = useState<TagFacet[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [sortMode, setSortMode] = useState<SearchMeta['sort']>('relevance');
  const [sortManuallySet, setSortManuallySet] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);

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
        ingestedAfter,
        ingestedBefore,
        sortMode
      ].join('|'),
    [parsedQuery.text, parsedQuery.tags, statusSignature, ingestedAfter, ingestedBefore, sortMode]
  );

  useEffect(() => {
    if (!parsedQuery.text) {
      setSortManuallySet(false);
    }
    if (parsedQuery.text && !sortManuallySet && sortMode !== 'relevance') {
      setSortMode('relevance');
    }
    if (!parsedQuery.text && !sortManuallySet && sortMode !== 'updated') {
      setSortMode('updated');
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
        if (ingestedAfter) {
          params.set('ingestedAfter', ingestedAfter);
        }
        if (ingestedBefore) {
          params.set('ingestedBefore', ingestedBefore);
        }
        params.set('sort', sortMode);
        const response = await fetch(`${API_BASE_URL}/apps?${params.toString()}`, {
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
          setSortMode(payload.meta.sort);
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
  }, [searchSignature, parsedQuery, statusFilters, ingestedAfter, ingestedBefore, sortMode]);

  useEffect(() => {
    const { activeToken } = autocompleteContext;
    if (!activeToken) {
      setSuggestions([]);
      setHighlightIndex(0);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(
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
        console.error(err);
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [autocompleteContext]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setHighlightIndex(0);
    } else {
      setHighlightIndex((current) => Math.min(current, suggestions.length - 1));
    }
  }, [suggestions]);

  const activeTokens = useMemo(() => searchMeta?.tokens ?? [], [searchMeta]);
  const highlightEnabled = showHighlights && activeTokens.length > 0;
  const formatScore = (value: number) => value.toFixed(2);
  const formatNormalizedScore = (value: number) => value.toFixed(3);
  const formatWeight = (value: number) => value.toFixed(1);

  const applySuggestion = (suggestion: TagSuggestion) => {
    setInputValue((prev) => {
      const { base } = computeAutocompleteContext(prev);
      const completion = suggestion.type === 'pair' ? `${suggestion.label} ` : suggestion.label;
      const needsSpace = base.length > 0 && !base.endsWith(' ');
      return `${needsSpace ? `${base} ` : base}${completion}`;
    });
    setSuggestions([]);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
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
  };

  const handleToggleStatus = (status: AppRecord['ingestStatus']) => {
    setStatusFilters((current) => {
      if (current.includes(status)) {
        return current.filter((item) => item !== status);
      }
      return [...current, status];
    });
  };

  const handleApplyTagFacet = (facet: TagFacet) => {
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
  };

  const handleClearDateFilters = () => {
    setIngestedAfter('');
    setIngestedBefore('');
  };

  const handleClearStatusFilters = () => {
    setStatusFilters([]);
  };

  const handleSortChange = (next: SearchMeta['sort']) => {
    setSortMode(next);
    setSortManuallySet(true);
  };

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      const response = await fetch(`${API_BASE_URL}/apps/${id}/retry`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? `Retry failed with status ${response.status}`);
      }
      if (payload?.data) {
        setApps((prev) =>
          prev.map((app) => (app.id === id ? { ...app, ...payload.data } : app))
        );
        if (historyState[id]?.open) {
          await fetchHistory(id, true);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetryingId(null);
    }
  };

  const fetchHistory = async (id: string, force = false) => {
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
      const response = await fetch(`${API_BASE_URL}/apps/${id}/history`);
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
  };

  const handleToggleHistory = async (id: string) => {
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
  };

  const fetchBuilds = async (
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
      const response = await fetch(`${API_BASE_URL}/apps/${id}/builds?${params.toString()}`);
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
            error: formatFetchError(err, 'Failed to load builds')
          }
        };
      });
    }
  };

  const handleToggleBuilds = async (id: string) => {
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
  };

  const handleLoadMoreBuilds = async (id: string) => {
    const state = buildState[id];
    if (!state || state.loadingMore || !state.meta || !state.meta.hasMore) {
      return;
    }
    const nextOffset = state.meta.nextOffset ?? state.builds.length;
    await fetchBuilds(id, { offset: nextOffset, append: true });
  };

  const fetchBuildLogs = async (appId: string, buildId: string) => {
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
      const response = await fetch(`${API_BASE_URL}/builds/${buildId}/logs`);
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
                error: formatFetchError(err, 'Failed to load logs'),
                content: existingLog?.content ?? null,
                size: existingLog?.size ?? 0,
                updatedAt: existingLog?.updatedAt ?? null
              }
            }
          }
        };
      });
    }
  };

  const handleToggleLogs = async (appId: string, buildId: string) => {
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
  };

  const handleRetryBuild = async (appId: string, buildId: string) => {
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
      const response = await fetch(`${API_BASE_URL}/builds/${buildId}/retry`, {
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
            error: formatFetchError(err, 'Failed to retry build')
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
  };

  const fetchLaunches = async (id: string, force = false) => {
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
      const response = await fetch(`${API_BASE_URL}/apps/${id}/launches`);
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
          error: formatFetchError(err, 'Failed to load launches'),
          launches: null
        }
      }));
    }
  };

  const handleToggleLaunches = async (id: string) => {
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
  };

  const handleLaunch = async (id: string) => {
    setLaunchingId(id);
    setLaunchErrors((prev) => ({ ...prev, [id]: null }));
    try {
      const response = await fetch(`${API_BASE_URL}/apps/${id}/launch`, {
        method: 'POST'
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
      setLaunchErrors((prev) => ({ ...prev, [id]: formatFetchError(err, 'Failed to launch app') }));
    } finally {
      setLaunchingId(null);
    }
  };

  const handleStopLaunch = async (appId: string, launchId: string) => {
    setStoppingLaunchId(launchId);
    setLaunchErrors((prev) => ({ ...prev, [appId]: null }));
    try {
      const response = await fetch(`${API_BASE_URL}/apps/${appId}/launches/${launchId}/stop`, {
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
      setLaunchErrors((prev) => ({ ...prev, [appId]: formatFetchError(err, 'Failed to stop launch') }));
    } finally {
      setStoppingLaunchId(null);
    }
  };

  const renderTags = (tags: TagKV[]) => (
    <div className="tag-row">
      {tags.map((tag) => (
        <span key={`${tag.key}:${tag.value}`} className="tag-chip">
          <span className="tag-key">{highlightSegments(tag.key, activeTokens, highlightEnabled)}</span>
          <span className="tag-separator">:</span>
          <span>{highlightSegments(tag.value, activeTokens, highlightEnabled)}</span>
        </span>
      ))}
    </div>
  );

  const renderBuildSection = (build: BuildSummary | null) => {
    if (!build) {
      return (
        <div className="build-section build-section-empty">
          <span className="status-badge status-pending">build pending</span>
          <span className="build-note">Awaiting first build run.</span>
        </div>
      );
    }

    const statusClass =
      build.status === 'succeeded'
        ? 'status-succeeded'
        : build.status === 'failed'
        ? 'status-failed'
        : build.status === 'running'
        ? 'status-processing'
        : 'status-pending';

    const updatedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;
    return (
      <div className="build-section">
        <div className="build-head">
          <span className={`status-badge ${statusClass}`}>build {build.status}</span>
          {updatedAt && (
            <time dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleString()}</time>
          )}
          {build.imageTag && (
            <code className="build-image-tag">{build.imageTag}</code>
          )}
        </div>
        {build.errorMessage && <p className="build-error">{build.errorMessage}</p>}
        {build.status === 'pending' && <span className="build-note">Waiting for build worker…</span>}
        {build.status === 'running' && <span className="build-note">Docker build in progress…</span>}
        {build.logsPreview && (
          <pre className="build-logs">
            {build.logsPreview}
            {build.logsTruncated ? '\n…' : ''}
          </pre>
        )}
      </div>
    );
  };

  const renderLaunchSection = (app: AppRecord) => {
    const launch = app.latestLaunch;
    const statusClass = launch
      ? launch.status === 'running'
        ? 'status-succeeded'
        : launch.status === 'failed'
        ? 'status-failed'
        : launch.status === 'starting' || launch.status === 'stopping'
        ? 'status-processing'
        : 'status-pending'
      : 'status-pending';
    const updatedAt = launch?.updatedAt ?? null;
    const isLaunching = launchingId === app.id;
    const isStopping = launch ? stoppingLaunchId === launch.id : false;
    const canLaunch = app.latestBuild?.status === 'succeeded';
    const canStop = launch ? ['running', 'starting', 'stopping'].includes(launch.status) : false;
    const launchError = launchErrors[app.id] ?? null;

    return (
      <div className={`launch-section${launch ? '' : ' launch-section-empty'}`}>
        <div className="launch-head">
          <span className={`status-badge ${statusClass}`}>
            {launch ? `launch ${launch.status}` : 'launch pending'}
          </span>
          {updatedAt && (
            <time dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleString()}</time>
          )}
          {launch?.instanceUrl && (
            <a className="launch-preview-link" href={launch.instanceUrl} target="_blank" rel="noreferrer">
              Preview
            </a>
          )}
        </div>
        {(launchError || launch?.errorMessage) && (
          <p className="launch-error">
            {highlightSegments(launchError ?? launch?.errorMessage ?? '', activeTokens, highlightEnabled)}
          </p>
        )}
        {!canLaunch && <p className="launch-note">Launch requires a successful build.</p>}
        {launch?.status === 'starting' && <p className="launch-note">Container starting…</p>}
        {launch?.status === 'stopping' && <p className="launch-note">Stopping container…</p>}
        {launch?.status === 'stopped' && <p className="launch-note">Last launch has ended.</p>}
        <div className="launch-actions">
          <button
            type="button"
            className="launch-button"
            onClick={() => {
              void handleLaunch(app.id);
            }}
            disabled={isLaunching || !canLaunch || canStop}
          >
            {isLaunching ? 'Launching…' : 'Launch app'}
          </button>
          <button
            type="button"
            className="launch-button secondary"
            onClick={() => {
              if (launch) {
                void handleStopLaunch(app.id, launch.id);
              }
            }}
            disabled={!launch || !canStop || isStopping}
          >
            {isStopping ? 'Stopping…' : 'Stop launch'}
          </button>
        </div>
        {launch?.instanceUrl && (
          <div className="launch-preview-row">
            <span>Preview URL:</span>
            <a href={launch.instanceUrl} target="_blank" rel="noreferrer">
              {launch.instanceUrl}
            </a>
          </div>
        )}
        {launch?.resourceProfile && <div className="launch-note">Profile: {launch.resourceProfile}</div>}
      </div>
    );
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-heading">
          <div>
            <h1>Web App Atlas</h1>
            <p>Discover and launch containerized web apps with tag-driven search.</p>
          </div>
          <nav className="hero-tabs">
            <button
              type="button"
              className={activeTab === 'catalog' ? 'active' : ''}
              onClick={() => setActiveTab('catalog')}
            >
              Catalog
            </button>
            <button
              type="button"
              className={activeTab === 'submit' ? 'active' : ''}
              onClick={() => setActiveTab('submit')}
            >
              Submit App
            </button>
          </nav>
        </div>
      </header>
      <main>
        {activeTab === 'catalog' ? (
          <>
            <section className="search-area">
              <div className="search-box">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type tags like framework:nextjs runtime:node18 or free text"
                  spellCheck={false}
                  autoFocus
                />
                {suggestions.length > 0 && (
                  <ul className="suggestion-list">
                    {suggestions.map((suggestion, index) => (
                      <li
                        key={`${suggestion.type}-${suggestion.value}`}
                        className={index === highlightIndex ? 'active' : ''}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestion(suggestion);
                        }}
                      >
                        <span className="suggestion-label">{suggestion.label}</span>
                        <span className="suggestion-type">{suggestion.type === 'key' ? 'key' : 'tag'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="search-controls">
                <div className="sort-controls">
                  <span className="controls-label">Sort by</span>
                  <div className="sort-options">
                    {(
                      [
                        { key: 'relevance', label: 'Relevance' },
                        { key: 'updated', label: 'Recently updated' },
                        { key: 'name', label: 'Name A→Z' }
                      ] as { key: SearchMeta['sort']; label: string }[]
                    ).map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={`sort-option${sortMode === option.key ? ' active' : ''}`}
                        onClick={() => handleSortChange(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={`highlight-toggle${activeTokens.length === 0 ? ' disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={showHighlights}
                    onChange={(event) => setShowHighlights(event.target.checked)}
                    disabled={activeTokens.length === 0}
                  />
                  Highlight matches
                </label>
              </div>
              {activeTokens.length > 0 && (
                <div className="search-meta-row">
                  <div className="token-chip-row">
                    {activeTokens.map((token) => (
                      <span key={token} className="token-chip">
                        {token}
                      </span>
                    ))}
                  </div>
                  {searchMeta && (
                    <div className="weight-chip-row">
                      <span className="weight-chip">name × {formatWeight(searchMeta.weights.name)}</span>
                      <span className="weight-chip">description × {formatWeight(searchMeta.weights.description)}</span>
                      <span className="weight-chip">tags × {formatWeight(searchMeta.weights.tags)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="search-hints">
                <span>Tab</span> accepts highlighted suggestion · <span>Esc</span> clears suggestions
              </div>
            </section>
            <section className="results">
              {loading && <div className="status">Loading apps…</div>}
              {error && !loading && <div className="status error">{error}</div>}
              {!loading && !error && apps.length === 0 && (
                <div className="status">No apps match your filters yet.</div>
              )}
              {!error && (
                <aside className="filter-panel">
                  <div className="filter-group">
                    <div className="filter-group-header">
                      <span>Ingest Status</span>
                      {statusFilters.length > 0 && (
                        <button
                          type="button"
                          className="filter-clear"
                          onClick={handleClearStatusFilters}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="filter-chip-row">
                      {statusFacets.map((facet) => {
                        const isActive = statusFilters.includes(facet.status);
                        const isDisabled = facet.count === 0 && !isActive;
                        return (
                          <button
                            key={facet.status}
                            type="button"
                            className={`filter-chip${isActive ? ' active' : ''}`}
                            onClick={() => handleToggleStatus(facet.status)}
                            disabled={isDisabled}
                          >
                            <span className="filter-chip-label">{facet.status}</span>
                            <span className="filter-chip-count">{facet.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="filter-group">
                    <div className="filter-group-header">
                      <span>Ingested Date</span>
                      {(ingestedAfter || ingestedBefore) && (
                        <button
                          type="button"
                          className="filter-clear"
                          onClick={handleClearDateFilters}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="filter-date-row">
                      <label>
                        From
                        <input
                          type="date"
                          value={ingestedAfter}
                          onChange={(event) => setIngestedAfter(event.target.value)}
                        />
                      </label>
                      <label>
                        To
                        <input
                          type="date"
                          value={ingestedBefore}
                          onChange={(event) => setIngestedBefore(event.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                  {tagFacets.length > 0 && (
                    <div className="filter-group">
                      <div className="filter-group-header">
                        <span>Popular Tags</span>
                      </div>
                      <div className="facet-tag-row">
                        {tagFacets.slice(0, 12).map((facet) => {
                          const token = `${facet.key}:${facet.value}`;
                          const isActive = parsedQuery.tags.includes(token);
                          return (
                            <button
                              key={token}
                              type="button"
                              className={`tag-facet${isActive ? ' active' : ''}`}
                              onClick={() => handleApplyTagFacet(facet)}
                              disabled={isActive}
                            >
                              <span className="tag-facet-label">{token}</span>
                              <span className="tag-facet-count">{facet.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {ownerFacets.length > 0 && (
                    <div className="filter-group">
                      <div className="filter-group-header">
                        <span>Top Owners</span>
                      </div>
                      <div className="facet-tag-row">
                        {ownerFacets.slice(0, 10).map((facet) => {
                          const token = `${facet.key}:${facet.value}`;
                          const isActive = parsedQuery.tags.includes(token);
                          return (
                            <button
                              key={token}
                              type="button"
                              className={`tag-facet${isActive ? ' active' : ''}`}
                              onClick={() => handleApplyTagFacet(facet)}
                              disabled={isActive}
                            >
                              <span className="tag-facet-label">{token}</span>
                              <span className="tag-facet-count">{facet.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {frameworkFacets.length > 0 && (
                    <div className="filter-group">
                      <div className="filter-group-header">
                        <span>Top Frameworks</span>
                      </div>
                      <div className="facet-tag-row">
                        {frameworkFacets.slice(0, 10).map((facet) => {
                          const token = `${facet.key}:${facet.value}`;
                          const isActive = parsedQuery.tags.includes(token);
                          return (
                            <button
                              key={token}
                              type="button"
                              className={`tag-facet${isActive ? ' active' : ''}`}
                              onClick={() => handleApplyTagFacet(facet)}
                              disabled={isActive}
                            >
                              <span className="tag-facet-label">{token}</span>
                              <span className="tag-facet-count">{facet.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </aside>
              )}
              <div className="grid">
                {apps.map((app) => {
                  const historyEntry = historyState[app.id];
                  const events = historyEntry?.events ?? [];
                  const showHistory = historyEntry?.open ?? false;

                  const buildEntry = buildState[app.id];
                  const showBuilds = buildEntry?.open ?? false;
                  const launchEntry = launchLists[app.id];
                  const launches = launchEntry?.launches ?? [];
                  const showLaunches = launchEntry?.open ?? false;

                  return (
                    <article key={app.id} className="app-card">
                      <div className="app-card-header">
                        <h2>{highlightSegments(app.name, activeTokens, highlightEnabled)}</h2>
                        <div className="app-card-meta">
                          <span className={`status-badge status-${app.ingestStatus}`}>{app.ingestStatus}</span>
                          <time dateTime={app.updatedAt}>Updated {new Date(app.updatedAt).toLocaleDateString()}</time>
                          <span className="attempts-pill">Attempts {app.ingestAttempts}</span>
                        </div>
                        {app.relevance && (
                          <div className="relevance-panel">
                            <div className="relevance-score-row">
                              <span className="relevance-score">
                                Score {formatScore(app.relevance.score)}
                              </span>
                              <span className="relevance-score secondary">
                                Normalized {formatNormalizedScore(app.relevance.normalizedScore)}
                              </span>
                            </div>
                            <div className="relevance-breakdown">
                              <span
                                title={`${app.relevance.components.name.hits} name hits × ${app.relevance.components.name.weight}`}
                              >
                                Name {formatScore(app.relevance.components.name.score)}
                              </span>
                              <span
                                title={`${app.relevance.components.description.hits} description hits × ${app.relevance.components.description.weight}`}
                              >
                                Description {formatScore(app.relevance.components.description.score)}
                              </span>
                              <span
                                title={`${app.relevance.components.tags.hits} tag hits × ${app.relevance.components.tags.weight}`}
                              >
                                Tags {formatScore(app.relevance.components.tags.score)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="app-description">
                        {highlightSegments(app.description, activeTokens, highlightEnabled)}
                      </p>
                      {app.ingestError && (
                        <p className="ingest-error">
                          {highlightSegments(app.ingestError, activeTokens, highlightEnabled)}
                        </p>
                      )}
                      {renderTags(app.tags)}
                      {renderBuildSection(app.latestBuild)}
                      {renderLaunchSection(app)}
                      <div className="app-links">
                        <a href={app.repoUrl} target="_blank" rel="noreferrer">
                          View repository
                        </a>
                        <code>{highlightSegments(app.dockerfilePath, activeTokens, highlightEnabled)}</code>
                        {app.ingestStatus === 'failed' && (
                          <button
                            type="button"
                            className="retry-button"
                            disabled={retryingId === app.id}
                            onClick={() => handleRetry(app.id)}
                          >
                            {retryingId === app.id ? 'Retrying…' : 'Retry ingest'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="timeline-button"
                          onClick={() => handleToggleBuilds(app.id)}
                        >
                          {showBuilds ? 'Hide builds' : 'View builds'}
                        </button>
                        <button
                          type="button"
                          className="history-button"
                          onClick={() => handleToggleLaunches(app.id)}
                        >
                          {showLaunches ? 'Hide launches' : 'View launches'}
                        </button>
                        <button
                          type="button"
                          className="history-button"
                          onClick={() => handleToggleHistory(app.id)}
                        >
                          {showHistory ? 'Hide history' : 'View history'}
                        </button>
                      </div>
                      {showBuilds && (
                        <div className="build-timeline">
                          {buildEntry?.loading && <div className="build-status">Loading builds…</div>}
                          {buildEntry?.error && !buildEntry.loading && (
                            <div className="build-status error">{buildEntry.error}</div>
                          )}
                          {!buildEntry?.loading && !buildEntry?.error && (buildEntry?.builds.length ?? 0) === 0 && (
                            <div className="build-status">No builds recorded yet.</div>
                          )}
                          {buildEntry?.builds.map((build) => {
                            const logState = buildEntry.logs[build.id];
                            const logOpen = logState?.open ?? false;
                            const logLoading = logState?.loading ?? false;
                            const logError = logState?.error ?? null;
                            const logSize = logState?.size ?? build.logsSize;
                            const logUpdatedAt = logState?.updatedAt ?? null;
                            const isRetryingBuild = buildEntry.retrying?.[build.id] ?? false;
                            const completedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;
                            const durationLabel = formatDuration(build.durationMs);
                            const downloadUrl = `${API_BASE_URL}/builds/${build.id}/logs?download=1`;
                            return (
                              <div key={build.id} className="build-timeline-item">
                                <div className="build-timeline-header">
                                  <span className={`status-badge status-${build.status}`}>build {build.status}</span>
                                  {build.commitSha && (
                                    <code className="build-commit">{build.commitSha.slice(0, 10)}</code>
                                  )}
                                  {completedAt && (
                                    <time dateTime={completedAt}>
                                      {new Date(completedAt).toLocaleString()}
                                    </time>
                                  )}
                                  {durationLabel && <span className="build-duration">{durationLabel}</span>}
                                  {build.imageTag && (
                                    <code className="build-image-tag">{build.imageTag}</code>
                                  )}
                                </div>
                                {build.errorMessage && (
                                  <p className="build-error">{build.errorMessage}</p>
                                )}
                                {build.logsPreview && (
                                  <pre className="build-logs-preview">
                                    {build.logsPreview}
                                    {build.logsTruncated ? '\n…' : ''}
                                  </pre>
                                )}
                                <div className="build-timeline-actions">
                                  <button
                                    type="button"
                                    className="log-toggle"
                                    onClick={() => handleToggleLogs(app.id, build.id)}
                                  >
                                    {logOpen ? 'Hide logs' : 'View logs'}
                                  </button>
                                  <a className="log-download" href={downloadUrl} target="_blank" rel="noreferrer">
                                    Download logs
                                  </a>
                                  {build.status === 'failed' && (
                                    <button
                                      type="button"
                                      className="retry-button"
                                      disabled={isRetryingBuild}
                                      onClick={() => handleRetryBuild(app.id, build.id)}
                                    >
                                      {isRetryingBuild ? 'Retrying…' : 'Retry build'}
                                    </button>
                                  )}
                                </div>
                                {logOpen && (
                                  <div className="build-log-viewer">
                                    {logLoading && <div className="build-log-status">Loading logs…</div>}
                                    {logError && !logLoading && (
                                      <div className="build-log-status error">{logError}</div>
                                    )}
                                    {!logLoading && !logError && (
                                      <>
                                        <div className="build-log-meta">
                                          <span>Size {formatBytes(logSize)}</span>
                                          {logUpdatedAt && (
                                            <time dateTime={logUpdatedAt}>
                                              Updated {new Date(logUpdatedAt).toLocaleString()}
                                            </time>
                                          )}
                                        </div>
                                        <pre className="build-log-output">
                                          {logState?.content ?? 'No logs available yet.'}
                                        </pre>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {buildEntry?.meta?.hasMore && (
                            <button
                              type="button"
                              className="build-load-more"
                              onClick={() => handleLoadMoreBuilds(app.id)}
                              disabled={buildEntry.loadingMore}
                            >
                              {buildEntry.loadingMore ? 'Loading…' : 'Load more builds'}
                            </button>
                          )}
                        </div>
                      )}
                      {showLaunches && (
                        <div className="launch-history">
                          {launchEntry?.loading && (
                            <div className="launch-status">Loading launches…</div>
                          )}
                          {launchEntry?.error && (
                            <div className="launch-status error">{launchEntry.error}</div>
                          )}
                          {launchEntry && !launchEntry.loading && !launchEntry.error && launches.length === 0 && (
                            <div className="launch-status">No launches recorded yet.</div>
                          )}
                          {launches.length > 0 && (
                            <ul className="launch-list">
                              {launches.map((launchItem) => {
                                const timestamp = launchItem.updatedAt ?? launchItem.createdAt;
                                return (
                                  <li key={launchItem.id}>
                                    <div className="launch-row">
                                      <span className={`launch-status-pill status-${launchItem.status}`}>
                                        {launchItem.status}
                                      </span>
                                      <time dateTime={timestamp}>
                                        {new Date(timestamp).toLocaleString()}
                                      </time>
                                      <code className="launch-build">{launchItem.buildId.slice(0, 8)}</code>
                                    </div>
                                    <div className="launch-detail">
                                      {launchItem.instanceUrl && (
                                        <a
                                          href={launchItem.instanceUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="launch-preview-link"
                                        >
                                          Open preview
                                        </a>
                                      )}
                                      {launchItem.errorMessage && (
                                        <div className="launch-error-text">
                                          {highlightSegments(launchItem.errorMessage, activeTokens, highlightEnabled)}
                                        </div>
                                      )}
                                      {launchItem.resourceProfile && (
                                        <span className="launch-profile">{launchItem.resourceProfile}</span>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                      {showHistory && (
                        <div className="history-section">
                          {historyEntry?.loading && <div className="history-status">Loading history…</div>}
                          {historyEntry?.error && (
                            <div className="history-status error">{historyEntry.error}</div>
                          )}
                          {historyEntry && !historyEntry.loading && !historyEntry.error && events.length === 0 && (
                            <div className="history-status">No events recorded yet.</div>
                          )}
                          {events.length > 0 && (
                            <ul className="history-list">
                              {events.map((event) => (
                                <li key={event.id}>
                                  <div className="history-row">
                                    <span className={`history-status-pill status-${event.status}`}>
                                      {event.status}
                                    </span>
                                    <time dateTime={event.createdAt}>
                                      {new Date(event.createdAt).toLocaleString()}
                                    </time>
                                  </div>
                                  <div className="history-detail">
                                    <div className="history-message">{event.message ?? 'No additional message'}</div>
                                    <div className="history-meta">
                                      {event.attempt !== null && (
                                        <span className="history-attempt">Attempt {event.attempt}</span>
                                      )}
                                      {typeof event.durationMs === 'number' && (
                                        <span className="history-duration">{`${Math.max(event.durationMs, 0)} ms`}</span>
                                      )}
                                      {event.commitSha && (
                                        <code className="history-commit">{event.commitSha.slice(0, 10)}</code>
                                      )}
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <SubmitApp
            onAppRegistered={(id: string) => {
              setActiveTab('catalog');
              setInputValue(id);
            }}
          />
        )}
      </main>
    </div>
  );
}

export default App;
