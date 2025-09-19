import { useEffect, useMemo, useState, type KeyboardEventHandler } from 'react';
import './App.css';

type TagKV = {
  key: string;
  value: string;
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
};

type TagSuggestion = {
  type: 'key' | 'pair';
  value: string;
  label: string;
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

function App() {
  const [inputValue, setInputValue] = useState('');
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<HistoryState>({});

  const autocompleteContext = useMemo(() => computeAutocompleteContext(inputValue), [inputValue]);
  const parsedQuery = useMemo(() => parseSearchInput(inputValue), [inputValue]);
  const searchSignature = useMemo(
    () => `${parsedQuery.text}|${parsedQuery.tags.join(',')}`,
    [parsedQuery.text, parsedQuery.tags]
  );

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
        const response = await fetch(`${API_BASE_URL}/apps?${params.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Search failed with status ${response.status}`);
        }
        const payload = await response.json();
        setApps(payload.data ?? []);
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
  }, [searchSignature, parsedQuery]);

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
          <span className="tag-key">{tag.key}</span>
          <span className="tag-separator">:</span>
          <span>{tag.value}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <h1>Web App Atlas</h1>
          <p>Search containerized web apps by descriptive tags. Use `framework:`, `category:`, `runtime:` and more.</p>
        </div>
      </header>
      <main>
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
          <div className="grid">
            {apps.map((app) => {
              const historyEntry = historyState[app.id];
              const events = historyEntry?.events ?? [];
              const showHistory = historyEntry?.open ?? false;

              return (
                <article key={app.id} className="app-card">
                  <div className="app-card-header">
                    <h2>{app.name}</h2>
                    <div className="app-card-meta">
                      <span className={`status-badge status-${app.ingestStatus}`}>{app.ingestStatus}</span>
                      <time dateTime={app.updatedAt}>Updated {new Date(app.updatedAt).toLocaleDateString()}</time>
                    <span className="attempts-pill">Attempts {app.ingestAttempts}</span>
                  </div>
                </div>
                <p className="app-description">{app.description}</p>
                {app.ingestError && (
                  <p className="ingest-error">{app.ingestError}</p>
                )}
                {renderTags(app.tags)}
                <div className="app-links">
                  <a href={app.repoUrl} target="_blank" rel="noreferrer">
                    View repository
                  </a>
                  <code>{app.dockerfilePath}</code>
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
      </main>
    </div>
  );
}

export default App;
