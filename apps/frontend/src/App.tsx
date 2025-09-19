import { Fragment, useEffect, useMemo, useState, type KeyboardEventHandler } from 'react';
import './App.css';
import SubmitApp from './SubmitApp';

type TagKV = {
  key: string;
  value: string;
};

type BuildSummary = {
  id: string;
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

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
                          className="history-button"
                          onClick={() => handleToggleHistory(app.id)}
                        >
                          {showHistory ? 'Hide history' : 'View history'}
                        </button>
                      </div>
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
