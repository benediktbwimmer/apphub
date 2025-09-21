import { useMemo, useState, type FormEventHandler } from 'react';
import { useApiTokens } from '../auth/ApiTokenContext';

type FormState = {
  label: string;
  token: string;
};

type FeedbackState = {
  error: string | null;
  success: string | null;
};

function formatInstant(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch {
    return iso;
  }
}

function maskToken(token: string): string {
  if (!token) {
    return '';
  }
  if (token.length <= 12) {
    return token;
  }
  const start = token.slice(0, 6);
  const end = token.slice(-4);
  return `${start}…${end}`;
}

type TokenRowProps = {
  id: string;
  label: string;
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
  onActivate: () => void;
  onUpdate: (updates: { label?: string; token?: string }) => void;
  onRemove: () => void;
};

function TokenRow({ id, label, token, createdAt, lastUsedAt, active, onActivate, onUpdate, onRemove }: TokenRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftToken, setDraftToken] = useState(token);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [editError, setEditError] = useState<string | null>(null);

  const handleStartEdit = () => {
    setDraftLabel(label);
    setDraftToken(token);
    setEditError(null);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditError(null);
    setDraftLabel(label);
    setDraftToken(token);
  };

  const handleSaveEdit = () => {
    const trimmedToken = draftToken.trim();
    if (!trimmedToken) {
      setEditError('Token value cannot be empty.');
      return;
    }
    onUpdate({ label: draftLabel.trim() || 'Untitled token', token: trimmedToken });
    setEditing(false);
    setEditError(null);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 shadow-sm transition-colors sm:flex-row sm:items-start sm:justify-between sm:gap-6 ${active ? 'border-blue-400 bg-blue-50/60 dark:border-blue-500/60 dark:bg-blue-500/10' : 'border-slate-200/70 bg-white/80 dark:border-slate-700/70 dark:bg-slate-900/60'}`}
    >
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow dark:bg-slate-100/10">
            {maskToken(token)}
          </span>
          {active ? (
            <span className="rounded-full bg-blue-600/15 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
              Active
            </span>
          ) : null}
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          <span>Created {formatInstant(createdAt)}</span>
          {' • '}
          <span>Last used {formatInstant(lastUsedAt)}</span>
        </div>
        {editing ? (
          <div className="mt-2 flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-white/80 p-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Label
              <input
                type="text"
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Token value
              <input
                type="text"
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
                autoComplete="off"
              />
            </label>
            {editError ? (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300" role="alert">
                {editError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                onClick={handleSaveEdit}
              >
                Save changes
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={handleCopy}
          >
            {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : 'Copy token'}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleStartEdit}
            disabled={editing}
          >
            {editing ? 'Editing…' : 'Edit details'}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-rose-500/20 dark:hover:text-rose-200"
            onClick={() => {
              const confirmed = window.confirm('Remove this token from your browser?');
              if (confirmed) {
                onRemove();
              }
            }}
          >
            Remove
          </button>
          {!active ? (
            <button
              type="button"
              className="rounded-full border border-blue-400 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 dark:border-blue-400/70 dark:text-blue-200 dark:hover:bg-blue-500/20"
              onClick={onActivate}
            >
              Make active
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function ApiAccessPage() {
  const { tokens, activeTokenId, addToken, removeToken, setActiveToken, updateToken } = useApiTokens();
  const [form, setForm] = useState<FormState>({ label: '', token: '' });
  const [feedback, setFeedback] = useState<FeedbackState>({ error: null, success: null });

  const sortedTokens = useMemo(
    () => tokens.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [tokens]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setFeedback({ error: null, success: null });
    try {
      const newId = addToken({ label: form.label, token: form.token });
      setForm({ label: '', token: '' });
      setFeedback({ error: null, success: 'Token saved and set as active for API requests.' });
      setActiveToken(newId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save token.';
      setFeedback({ error: message, success: null });
    }
  };

  const handleFormFieldChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">API Access</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Store operator tokens in your browser so authenticated actions—launching workflows, retrying jobs,
          or managing services—work without pasting headers each time. Tokens are saved to local storage on this
          device only.
        </p>
      </header>
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Add a token</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Use the value from <code className="rounded bg-slate-900/90 px-1 py-0.5 text-xs text-white">operator-tokens.json</code>
          or an inline <code className="rounded bg-slate-900/90 px-1 py-0.5 text-xs text-white">APPHUB_OPERATOR_TOKENS</code> entry.
        </p>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Label (optional)
            <input
              type="text"
              value={form.label}
              onChange={(event) => handleFormFieldChange('label', event.target.value)}
              placeholder="Platform Ops"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            API token
            <input
              type="text"
              value={form.token}
              onChange={(event) => handleFormFieldChange('token', event.target.value)}
              placeholder="apphub_..."
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
              required
            />
          </label>
          {feedback.error ? (
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-300" role="alert">
              {feedback.error}
            </p>
          ) : null}
          {feedback.success ? (
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-300" role="status">
              {feedback.success}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              Save token
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => {
                setForm({ label: '', token: '' });
                setFeedback({ error: null, success: null });
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </div>
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stored tokens</h2>
        {sortedTokens.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-4 text-sm text-slate-600 dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-300">
            No tokens saved yet. Add at least one token so protected API endpoints accept your requests.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {sortedTokens.map((token) => (
              <TokenRow
                key={token.id}
                id={token.id}
                label={token.label}
                token={token.token}
                createdAt={token.createdAt}
                lastUsedAt={token.lastUsedAt}
                active={token.id === activeTokenId}
                onActivate={() => setActiveToken(token.id)}
                onUpdate={(updates) => updateToken(token.id, updates)}
                onRemove={() => removeToken(token.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
