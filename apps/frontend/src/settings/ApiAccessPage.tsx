import { useEffect, useMemo, useState, type FormEventHandler } from 'react';
import { useAuth } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';

const SCOPE_METADATA: Record<string, { title: string; description: string }> = {
  'jobs:run': {
    title: 'Run jobs',
    description: 'Enqueue existing job definitions for execution.'
  },
  'jobs:write': {
    title: 'Manage jobs',
    description: 'Create, update, and delete job definitions.'
  },
  'workflows:run': {
    title: 'Run workflows',
    description: 'Trigger existing workflow definitions.'
  },
  'workflows:write': {
    title: 'Manage workflows',
    description: 'Create and edit workflow definitions.'
  },
  'job-bundles:read': {
    title: 'Read job bundles',
    description: 'Download published job bundles for local inspection.'
  },
  'job-bundles:write': {
    title: 'Publish job bundles',
    description: 'Upload new bundle versions to the registry.'
  },
  'auth:manage-api-keys': {
    title: 'Manage API keys',
    description: 'Create and revoke API keys for this account.'
  }
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

function classifyKeyStatus(expiresAt: string | null, revokedAt: string | null): 'revoked' | 'expired' | 'active' {
  if (revokedAt) {
    return 'revoked';
  }
  if (expiresAt) {
    const expiry = new Date(expiresAt).getTime();
    if (!Number.isNaN(expiry) && expiry < Date.now()) {
      return 'expired';
    }
  }
  return 'active';
}

type CreateFormState = {
  name: string;
  expiresAt: string;
};

type MessageState = {
  type: 'success' | 'error';
  text: string;
};

export default function ApiAccessPage() {
  const {
    identity,
    identityLoading,
    identityError,
    refreshIdentity,
    apiKeys,
    apiKeysLoading,
    apiKeysError,
    refreshApiKeys,
    createApiKey,
    revokeApiKey,
    activeToken,
    setActiveToken
  } = useAuth();
  const authorizedFetch = useAuthorizedFetch();

  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [createForm, setCreateForm] = useState<CreateFormState>({ name: '', expiresAt: '' });
  const [createMessage, setCreateMessage] = useState<MessageState | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [logoutMessage, setLogoutMessage] = useState<MessageState | null>(null);

  useEffect(() => {
    if (identity) {
      setSelectedScopes(new Set(identity.scopes));
    } else {
      setSelectedScopes(new Set());
    }
  }, [identity]);

  const availableScopes = useMemo(() => identity?.scopes ?? [], [identity]);

  const orderedScopes = useMemo(
    () =>
      Array.from(new Set([...availableScopes, ...Object.keys(SCOPE_METADATA)])).map((scope) => ({
        id: scope,
        meta: SCOPE_METADATA[scope] ?? { title: scope, description: '' }
      })),
    [availableScopes]
  );

  const handleScopeToggle = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  const handleCreateKey: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setCreateMessage(null);
    setCreatedSecret(null);

    const scopes = Array.from(selectedScopes);
    if (scopes.length === 0) {
      setCreateMessage({ type: 'error', text: 'Select at least one scope for the API key.' });
      return;
    }

    let expiresAtIso: string | null = null;
    if (createForm.expiresAt) {
      const parsed = new Date(createForm.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        setCreateMessage({ type: 'error', text: 'Expiration must be a valid date and time.' });
        return;
      }
      expiresAtIso = parsed.toISOString();
    }

    try {
      const { key, token } = await createApiKey({
        name: createForm.name.trim() || undefined,
        scopes,
        expiresAt: expiresAtIso
      });
      setCreateMessage({ type: 'success', text: 'API key created. Copy the token now; it will not be shown again.' });
      setCreatedSecret(token);
      setActiveToken(token);
      setCreateForm({ name: '', expiresAt: '' });
      setSelectedScopes(new Set(key.scopes));
    } catch (err) {
      setCreateMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create API key.'
      });
    }
  };

  const handleLogout = async () => {
    setLogoutMessage(null);
    try {
      await authorizedFetch('/auth/logout', { method: 'POST' });
      setActiveToken(null);
      await Promise.all([refreshIdentity(), refreshApiKeys()]);
      setLogoutMessage({ type: 'success', text: 'Signed out successfully.' });
    } catch (err) {
      setLogoutMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to sign out.'
      });
    }
  };

  const handleLogin = () => {
    const redirect = encodeURIComponent(window.location.pathname);
    window.location.href = `/auth/login?redirectTo=${redirect}`;
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">API Access</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Authenticate with your organization account to manage workflow runs and issue API keys for automation.
        </p>
      </header>

      {identityLoading ? (
        <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
          Loading your session information…
        </div>
      ) : null}

      {identityError ? (
        <div className="rounded-3xl border border-rose-200/70 bg-rose-50/80 p-6 text-sm text-rose-700 shadow dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center justify-between">
            <span>{identityError}</span>
            <button
              type="button"
              className="rounded-full border border-rose-400 px-3 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-rose-500/60 dark:text-rose-200 dark:hover:bg-rose-500/20"
              onClick={() => {
                void refreshIdentity();
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {!identity && !identityLoading ? (
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-700 shadow dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
          <p>
            You\'re not signed in. Use your organization account to access protected workflows and manage API keys for
            automation.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              onClick={handleLogin}
            >
              Sign in with SSO
            </button>
          </div>
        </div>
      ) : null}

      {logoutMessage ? (
        <div
          className={`rounded-2xl border p-4 text-sm shadow ${
            logoutMessage.type === 'success'
              ? 'border-emerald-300/70 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-200'
              : 'border-rose-300/70 bg-rose-50/80 text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200'
          }`}
        >
          {logoutMessage.text}
        </div>
      ) : null}

      {identity ? (
        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Signed in as</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {identity.displayName ?? identity.subject}{' '}
                {identity.email ? <span className="text-slate-400">({identity.email})</span> : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {identity.roles.length > 0 ? identity.roles.map((role) => (
                <span key={role} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  {role}
                </span>
              )) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  {identity.kind}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
              {identity.scopes.map((scope) => (
                <span key={scope} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-200">
                  {scope}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {identity ? (
        <section className="flex flex-col gap-6 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create API key</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              API keys inherit your current scopes by default. Provide a label and optional expiration to generate a token
              for CLI automation or service integration.
            </p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleCreateKey}>
            <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
              Label (optional)
              <input
                type="text"
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
                placeholder="Production automation"
              />
            </label>
            <fieldset className="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-600">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Scopes
              </legend>
              {orderedScopes.map(({ id, meta }) => (
                <label key={id} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600"
                    checked={selectedScopes.has(id)}
                    onChange={() => handleScopeToggle(id)}
                    disabled={!availableScopes.includes(id)}
                  />
                  <span>
                    <span className="font-semibold text-slate-700 dark:text-slate-100">{meta.title}</span>
                    {meta.description ? <span className="block text-xs text-slate-500 dark:text-slate-400">{meta.description}</span> : null}
                    {!availableScopes.includes(id) ? (
                      <span className="mt-1 block text-xs font-semibold text-slate-400">
                        Scope not currently granted to your account.
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
              Expiration (optional)
              <input
                type="datetime-local"
                value={createForm.expiresAt}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
              />
              <span className="text-xs text-slate-400 dark:text-slate-500">Leave blank for a non-expiring key.</span>
            </label>
            {createMessage ? (
              <p
                className={`text-sm font-semibold ${
                  createMessage.type === 'success'
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : 'text-rose-600 dark:text-rose-300'
                }`}
                role="alert"
              >
                {createMessage.text}
              </p>
            ) : null}
            {createdSecret ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-300/70 bg-emerald-50/80 p-4 text-sm text-emerald-700 shadow dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-200">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">New API key token</span>
                  <button
                    type="button"
                    className="rounded-full border border-emerald-400 px-3 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 dark:border-emerald-400/70 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(createdSecret);
                      } catch {
                        console.warn('Failed to copy API key token to clipboard.');
                      }
                    }}
                  >
                    Copy token
                  </button>
                </div>
                <code className="break-all rounded-xl bg-white/80 px-3 py-2 text-xs shadow-inner dark:bg-slate-900/60">
                  {createdSecret}
                </code>
              </div>
            ) : null}
            <button
              type="submit"
              className="self-start rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              Generate API key
            </button>
          </form>
        </section>
      ) : null}

      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Existing API keys</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Revoke keys that are no longer needed. Expired or revoked keys stop working immediately.
          </p>
        </div>
        {apiKeysError ? (
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 p-4 text-sm text-rose-700 shadow dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
            {apiKeysError}
          </div>
        ) : null}
        {apiKeysLoading ? (
          <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 text-sm text-slate-600 shadow-inner dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-300">
            Loading API keys…
          </div>
        ) : apiKeys.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 shadow-inner dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-400">
            No API keys yet. Generate one above to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {apiKeys.map((key) => {
              const status = classifyKeyStatus(key.expiresAt, key.revokedAt);
              return (
                <li
                  key={key.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{key.name ?? 'Unnamed key'}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Prefix {key.prefix}</span>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                        status === 'active'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                          : status === 'expired'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>Created {formatInstant(key.createdAt)}</span>
                    <span>•</span>
                    <span>Last used {formatInstant(key.lastUsedAt)}</span>
                    <span>•</span>
                    <span>Expires {formatInstant(key.expiresAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                    {key.scopes.map((scope) => (
                      <span key={`${key.id}-${scope}`} className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700">
                        {scope}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                      onClick={async () => {
                        await navigator.clipboard.writeText(key.prefix);
                      }}
                    >
                      Copy prefix
                    </button>
                    {status === 'active' ? (
                      <button
                        type="button"
                        className="rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 dark:border-rose-500/70 dark:text-rose-200 dark:hover:bg-rose-500/20"
                        onClick={() => {
                          const confirmed = window.confirm('Revoke this API key? This action cannot be undone.');
                          if (confirmed) {
                            void revokeApiKey(key.id).catch((err) => {
                              alert(err instanceof Error ? err.message : 'Failed to revoke API key.');
                            });
                          }
                        }}
                      >
                        Revoke key
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Browser API token override</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
          Paste an API key token here to send it with subsequent API requests from this browser. Leave the field empty to
          rely on your signed-in session.
          </p>
        </div>
        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
          Active token
          <input
            type="text"
            value={activeToken ?? ''}
            onChange={(event) => setActiveToken(event.target.value.trim() ? event.target.value.trim() : null)}
            placeholder="apphub_live_…"
            autoComplete="off"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
          />
        </label>
        <button
          type="button"
          className="self-start rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={() => setActiveToken(null)}
        >
          Clear token override
        </button>
      </section>
    </section>
  );
}
