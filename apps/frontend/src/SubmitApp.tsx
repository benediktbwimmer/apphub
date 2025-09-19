import { useEffect, useMemo, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

type TagInput = {
  key: string;
  value: string;
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

type AppRecord = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  ingestStatus: 'seed' | 'pending' | 'processing' | 'ready' | 'failed';
  ingestError: string | null;
  ingestAttempts: number;
  updatedAt: string;
  tags: TagInput[];
};

interface SubmitAppProps {
  onAppRegistered?: (id: string) => void;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 32) || `app-${Date.now()}`;
}

function SubmitApp({ onAppRegistered }: SubmitAppProps) {
  const [form, setForm] = useState({
    id: '',
    name: '',
    description: '',
    repoUrl: '',
    dockerfilePath: 'Dockerfile',
    tags: [{ key: 'language', value: 'javascript' } as TagInput]
  });
  const [sourceType, setSourceType] = useState<'remote' | 'local'>('remote');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentApp, setCurrentApp] = useState<AppRecord | null>(null);
  const [history, setHistory] = useState<IngestionEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const appId = useMemo(() => currentApp?.id ?? null, [currentApp]);

  useEffect(() => {
    if (!appId) {
      return;
    }
    const controller = new AbortController();
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/apps/${appId}`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Failed to load app status (${res.status})`);
        }
        const payload = await res.json();
        setCurrentApp(payload.data);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
      }
    }, 1000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [appId]);

  const handleTagChange = (index: number, key: keyof TagInput, value: string) => {
    setForm((prev) => {
      const next = [...prev.tags];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, tags: next };
    });
  };

  const addTagField = () => {
    setForm((prev) => ({ ...prev, tags: [...prev.tags, { key: '', value: '' }] }));
  };

  const removeTagField = (index: number) => {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((_, i) => i !== index) }));
  };

  const fetchHistory = async (id: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/apps/${id}/history`);
      if (!res.ok) {
        throw new Error(`Failed to load history (${res.status})`);
      }
      const payload = await res.json();
      setHistory(payload.data ?? []);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const id = form.id || slugify(form.name);
      const body = {
        id,
        name: form.name,
        description: form.description,
        repoUrl: sourceType === 'local' && form.repoUrl && !form.repoUrl.startsWith('file://')
          ? form.repoUrl
          : form.repoUrl,
        dockerfilePath: form.dockerfilePath,
        tags: form.tags.filter((tag) => tag.key && tag.value)
      };

      const response = await fetch(`${API_BASE_URL}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? `Submission failed with status ${response.status}`);
      }

      const payload = await response.json();
      setCurrentApp(payload.data);
      setHistory([]);
      if (onAppRegistered) {
        onAppRegistered(id);
      }
      await fetchHistory(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const disableSubmit =
    submitting || !form.name || !form.description || !form.repoUrl || !form.dockerfilePath;

  return (
    <section className="submit-shell">
      <form className="submit-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label htmlFor="app-name">Application Name</label>
          <input
            id="app-name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="My Awesome App"
            required
          />
        </div>
        <div className="form-row">
          <label htmlFor="app-id">Application ID</label>
          <input
            id="app-id"
            value={form.id}
            onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
            placeholder="Optional – auto-generated from name"
          />
        </div>
        <div className="form-row">
          <label htmlFor="app-description">Description</label>
          <textarea
            id="app-description"
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Short summary shown in the catalog"
            rows={3}
            required
          />
        </div>
        <div className="form-row">
          <label>Repository Source</label>
          <div className="source-toggle">
            <button
              type="button"
              className={sourceType === 'remote' ? 'active' : ''}
              onClick={() => setSourceType('remote')}
            >
              Remote (git/https)
            </button>
            <button
              type="button"
              className={sourceType === 'local' ? 'active' : ''}
              onClick={() => setSourceType('local')}
            >
              Local path
            </button>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="repo-url">Repository URL or Path</label>
          <input
            id="repo-url"
            value={form.repoUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, repoUrl: event.target.value }))}
            placeholder={sourceType === 'local' ? '/absolute/path/to/repo' : 'https://github.com/user/project.git'}
            required
          />
          <p className="field-hint">
            {sourceType === 'local'
              ? 'Provide an absolute path to a Git repository on this machine.'
              : 'Provide a cloneable Git URL (https://, git@, etc.).'}
          </p>
        </div>
        <div className="form-row">
          <label htmlFor="dockerfile-path">Dockerfile Path</label>
          <input
            id="dockerfile-path"
            value={form.dockerfilePath}
            onChange={(event) => setForm((prev) => ({ ...prev, dockerfilePath: event.target.value }))}
            placeholder="Dockerfile"
            required
          />
        </div>
        <div className="form-row">
          <label>Tags</label>
          <div className="tag-editor">
            {form.tags.map((tag, index) => (
              <div key={index} className="tag-editor-row">
                <input
                  value={tag.key}
                  onChange={(event) => handleTagChange(index, 'key', event.target.value)}
                  placeholder="key"
                />
                <span>:</span>
                <input
                  value={tag.value}
                  onChange={(event) => handleTagChange(index, 'value', event.target.value)}
                  placeholder="value"
                />
                {form.tags.length > 1 && (
                  <button type="button" onClick={() => removeTagField(index)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="add-tag" onClick={addTagField}>
              Add tag
            </button>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" disabled={disableSubmit}>
            {submitting ? 'Submitting…' : 'Register Application'}
          </button>
          {error && <div className="status error">{error}</div>}
        </div>
      </form>

      {currentApp && (
        <div className="submit-status">
          <h2>Status</h2>
          <div className="status-card">
            <div className="status-row">
              <span className={`status-badge status-${currentApp.ingestStatus}`}>
                {currentApp.ingestStatus}
              </span>
              <span className="attempts-pill">Attempts {currentApp.ingestAttempts}</span>
            </div>
            <p>{currentApp.description}</p>
            {currentApp.ingestError && <p className="ingest-error">{currentApp.ingestError}</p>}
            <div className="status-details">
              <div>
                <span className="label">Repo URL</span>
                <code>{currentApp.repoUrl}</code>
              </div>
              <div>
                <span className="label">Dockerfile</span>
                <code>{currentApp.dockerfilePath}</code>
              </div>
            </div>
            <button type="button" className="history-button" onClick={() => fetchHistory(currentApp.id)}>
              Refresh history
            </button>
          </div>
          <div className="history-section">
            {historyLoading && <div className="history-status">Loading history…</div>}
            {historyError && <div className="history-status error">{historyError}</div>}
            {!historyLoading && !historyError && history.length === 0 && (
              <div className="history-status">No ingestion events yet.</div>
            )}
            {history.length > 0 && (
              <ul className="history-list">
                {history.map((event) => (
                  <li key={event.id}>
                    <div className="history-row">
                      <span className={`history-status-pill status-${event.status}`}>{event.status}</span>
                      <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
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
        </div>
      )}
    </section>
  );
}

export default SubmitApp;
