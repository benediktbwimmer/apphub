import classNames from 'classnames';
import { useEffect, useMemo, useState, type FormEventHandler } from 'react';
import { useAuth } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner } from '../components';
import { getStatusToneClasses } from '../theme/statusTokens';
import {
  SETTINGS_ALERT_ERROR_CLASSES,
  SETTINGS_ALERT_INFO_CLASSES,
  SETTINGS_ALERT_SUCCESS_CLASSES,
  SETTINGS_BADGE_ITEM_CLASSES,
  SETTINGS_BADGE_ITEM_SOFT_CLASSES,
  SETTINGS_BADGE_LIST_CLASSES,
  SETTINGS_CARD_CONTAINER_CLASSES,
  SETTINGS_DANGER_BUTTON_CLASSES,
  SETTINGS_FORM_CHECKBOX_CLASSES,
  SETTINGS_FORM_LABEL_CLASSES,
  SETTINGS_FORM_INPUT_CLASSES,
  SETTINGS_HEADER_SUBTITLE_CLASSES,
  SETTINGS_HEADER_TITLE_CLASSES,
  SETTINGS_PRIMARY_BUTTON_CLASSES,
  SETTINGS_SECONDARY_BUTTON_CLASSES,
  SETTINGS_SECTION_HELPER_CLASSES,
  SETTINGS_SECTION_LABEL_CLASSES,
  SETTINGS_SECTION_SUBTITLE_CLASSES,
  SETTINGS_SECTION_TITLE_CLASSES
} from './settingsTokens';

const SCOPE_METADATA: Record<string, { title: string; description: string }> = {
  'metastore:read': {
    title: 'Read metastore records',
    description: 'Query metadata namespaces and audit history.'
  },
  'metastore:write': {
    title: 'Write metastore records',
    description: 'Create or update metadata documents and tags.'
  },
  'metastore:delete': {
    title: 'Delete metastore records',
    description: 'Soft-delete metadata entries or restore them when required.'
  },
  'metastore:admin': {
    title: 'Administer metastore',
    description: 'Permanently purge records and manage token reloads.'
  },
  'filestore:read': {
    title: 'Read filestore nodes',
    description: 'Inspect directories and node metadata across backends.'
  },
  'filestore:write': {
    title: 'Write filestore nodes',
    description: 'Create directories, update metadata, and prune nodes.'
  },
  'filestore:admin': {
    title: 'Administer filestore',
    description: 'Trigger reconciliations, enforce consistency, and manage backends.'
  },
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
  'runtime:write': {
    title: 'Manage runtime scaling',
    description: 'Adjust runtime concurrency for workers and queues.'
  },
  'auth:manage-api-keys': {
    title: 'Manage API keys',
    description: 'Create and revoke API keys for this account.'
  },
  'timestore:read': {
    title: 'Read timestore datasets',
    description: 'List datasets and execute read-only queries.'
  },
  'timestore:write': {
    title: 'Write timestore datasets',
    description: 'Ingest new partitions or modify dataset metadata.'
  },
  'timestore:admin': {
    title: 'Administer timestore',
    description: 'Run lifecycle jobs, change retention policies, and view metrics.'
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

function keyStatusTone(status: 'revoked' | 'expired' | 'active'): string {
  switch (status) {
    case 'active':
      return getStatusToneClasses('success');
    case 'expired':
      return getStatusToneClasses('warning');
    default:
      return getStatusToneClasses('danger');
  }
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
  const authDisabled = identity?.authDisabled ?? false;

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

  const orderedScopes = useMemo(() => {
    const combined = Array.from(new Set([...availableScopes, ...Object.keys(SCOPE_METADATA)]));
    combined.sort((a, b) => a.localeCompare(b));
    return combined.map((scope) => ({
      id: scope,
      meta: SCOPE_METADATA[scope] ?? { title: scope, description: '' }
    }));
  }, [availableScopes]);

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
      <header className={SETTINGS_CARD_CONTAINER_CLASSES}>
        <h2 className={SETTINGS_HEADER_TITLE_CLASSES}>API Access</h2>
        <p className={SETTINGS_HEADER_SUBTITLE_CLASSES}>
          Authenticate with your organization account to manage workflow runs and issue API keys for automation.
        </p>
      </header>

      {identityLoading ? (
        <div className={SETTINGS_CARD_CONTAINER_CLASSES}>
          <Spinner label="Loading your session information…" size="sm" />
        </div>
      ) : null}

      {identityError ? (
        <div className={classNames(SETTINGS_ALERT_ERROR_CLASSES, "shadow-elevation-sm")}>
          <div className="flex items-center justify-between">
            <span>{identityError}</span>
            <button
              type="button"
              className={classNames(SETTINGS_SECONDARY_BUTTON_CLASSES, getStatusToneClasses('danger'))}
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
        <div className={SETTINGS_CARD_CONTAINER_CLASSES}>
          <p>
            You\'re not signed in. Use your organization account to access protected workflows and manage API keys for
            automation.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASSES} onClick={handleLogin}>
              Sign in with SSO
            </button>
          </div>
        </div>
      ) : null}

      {logoutMessage ? (
        <div
          className={classNames(
            logoutMessage.type === 'success' ? SETTINGS_ALERT_SUCCESS_CLASSES : SETTINGS_ALERT_ERROR_CLASSES,
            'shadow-elevation-sm'
          )}
        >
          {logoutMessage.text}
        </div>
      ) : null}

      {identity ? (
        <section className={SETTINGS_CARD_CONTAINER_CLASSES}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>Signed in as</h3>
              <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>
                {identity.displayName ?? identity.subject}{' '}
                {identity.email ? <span className={SETTINGS_SECTION_HELPER_CLASSES}>({identity.email})</span> : null}
              </p>
            </div>
            <div className={SETTINGS_BADGE_LIST_CLASSES}>
              {identity.roles.length > 0 ? identity.roles.map((role) => (
                <span key={role} className={SETTINGS_BADGE_ITEM_SOFT_CLASSES}>
                  {role}
                </span>
              )) : (
                <span className={SETTINGS_BADGE_ITEM_SOFT_CLASSES}>
                  {identity.kind}
                </span>
              )}
            </div>
            <div className={SETTINGS_BADGE_LIST_CLASSES}>
              {identity.scopes.map((scope) => (
                <span key={scope} className={SETTINGS_BADGE_ITEM_CLASSES}>
                  {scope}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {authDisabled ? (
                <span className={SETTINGS_SECTION_LABEL_CLASSES}>
                  Authentication disabled for local access
                </span>
              ) : (
                <button
                  type="button"
                  className={SETTINGS_SECONDARY_BUTTON_CLASSES}
                  onClick={handleLogout}
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {identity ? (
        authDisabled ? (
          <section className={SETTINGS_CARD_CONTAINER_CLASSES}>
            <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>Local access mode</h3>
            <p className={classNames('mt-2', SETTINGS_SECTION_SUBTITLE_CLASSES)}>
              Authentication is disabled in this environment. Every request runs with full operator privileges, so API keys
              and sign-in flows are unnecessary.
            </p>
          </section>
        ) : (
          <section className={classNames(SETTINGS_CARD_CONTAINER_CLASSES, "gap-6")}>
            <div className="flex flex-col gap-2">
              <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>Create API key</h3>
              <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>
                API keys inherit your current scopes by default. Provide a label and optional expiration to generate a token
                for CLI automation or service integration.
              </p>
            </div>
            <form className="flex flex-col gap-4" onSubmit={handleCreateKey}>
              <label className={SETTINGS_FORM_LABEL_CLASSES}>
                Label (optional)
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                  className={SETTINGS_FORM_INPUT_CLASSES}
                  placeholder="Production automation"
                />
              </label>
              <fieldset className="flex flex-col gap-3 rounded-2xl border border-dashed border-subtle p-4">
                <legend className={classNames('px-2', SETTINGS_SECTION_LABEL_CLASSES)}>
                  Scopes
                </legend>
                {orderedScopes.map(({ id, meta }) => (
                  <label key={id} className={classNames('flex items-start gap-3', SETTINGS_FORM_LABEL_CLASSES)}>
                    <input
                      type="checkbox"
                      className={SETTINGS_FORM_CHECKBOX_CLASSES}
                      checked={selectedScopes.has(id)}
                      onChange={() => handleScopeToggle(id)}
                      disabled={!availableScopes.includes(id)}
                    />
                    <span>
                      <span className="font-weight-semibold text-primary">{meta.title}</span>
                      {meta.description ? <span className={classNames('block', SETTINGS_SECTION_HELPER_CLASSES)}>{meta.description}</span> : null}
                      {!availableScopes.includes(id) ? (
                        <span className={classNames('mt-1 block', SETTINGS_SECTION_HELPER_CLASSES)}>
                          Scope not currently granted to your account.
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className={SETTINGS_FORM_LABEL_CLASSES}>
                Expiration (optional)
                <input
                  type="datetime-local"
                  value={createForm.expiresAt}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                  className={SETTINGS_FORM_INPUT_CLASSES}
                />
                <span className={SETTINGS_SECTION_HELPER_CLASSES}>Leave blank for a non-expiring key.</span>
              </label>
              {createMessage ? (
                <p
                  className={classNames(
                    SETTINGS_SECTION_SUBTITLE_CLASSES,
                    'font-weight-semibold',
                    createMessage.type === 'success' ? 'text-status-success' : 'text-status-danger'
                  )}
                  role="alert"
                >
                  {createMessage.text}
                </p>
              ) : null}
              {createdSecret ? (
                <div className={classNames(SETTINGS_ALERT_SUCCESS_CLASSES, 'shadow-elevation-sm', 'flex flex-col gap-3')}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-weight-semibold text-primary">New API key token</span>
                    <button
                      type="button"
                      className={SETTINGS_SECONDARY_BUTTON_CLASSES}
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
                  <code className="break-all rounded-2xl bg-surface-muted px-3 py-2 text-scale-xs text-primary shadow-inner">
                    {createdSecret}
                  </code>
                </div>
              ) : null}
              <button
                type="submit"
                className={SETTINGS_PRIMARY_BUTTON_CLASSES}
              >
                Generate API key
              </button>
            </form>
          </section>
        )
      ) : null}




      <section className={classNames(SETTINGS_CARD_CONTAINER_CLASSES, 'gap-4')}>
        <div className="flex flex-col gap-2">
          <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>Existing API keys</h3>
          <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>
            Revoke keys that are no longer needed. Expired or revoked keys stop working immediately.
          </p>
        </div>
        {authDisabled ? (
          <div className={classNames(SETTINGS_ALERT_INFO_CLASSES, 'shadow-elevation-sm')}>
            Authentication is disabled locally, so API keys cannot be created or revoked in this mode.
          </div>
        ) : (
          <>
            {apiKeysError ? (
              <div className={classNames(SETTINGS_ALERT_ERROR_CLASSES, "shadow-elevation-sm")}>
                {apiKeysError}
              </div>
            ) : null}
            {apiKeysLoading ? (
              <div className={SETTINGS_CARD_CONTAINER_CLASSES}>
                <Spinner label="Loading API keys…" size="sm" />
              </div>
            ) : apiKeys.length === 0 ? (
              <div className={classNames(SETTINGS_ALERT_INFO_CLASSES, 'shadow-elevation-sm')}>
                No API keys yet. Generate one above to get started.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {apiKeys.map((key) => {
                  const status = classifyKeyStatus(key.expiresAt, key.revokedAt);
                  return (
                    <li
                      key={key.id}
                      className={classNames(SETTINGS_CARD_CONTAINER_CLASSES, 'gap-3')}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-scale-sm font-weight-semibold text-primary">{key.name ?? 'Unnamed key'}</span>
                          <span className={SETTINGS_SECTION_HELPER_CLASSES}>Prefix {key.prefix}</span>
                        </div>
                        <span
                          className={classNames(
                            'rounded-full px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-wide',
                            keyStatusTone(status)
                          )}
                        >
                          {status}
                        </span>
                      </div>
                      <div className={classNames(SETTINGS_BADGE_LIST_CLASSES, 'text-scale-xs text-secondary')}>
                        <span>Created {formatInstant(key.createdAt)}</span>
                        <span>•</span>
                        <span>Last used {formatInstant(key.lastUsedAt)}</span>
                        <span>•</span>
                        <span>Expires {formatInstant(key.expiresAt)}</span>
                      </div>
                      <div className={SETTINGS_BADGE_LIST_CLASSES}>
                        {key.scopes.map((scope) => (
                          <span key={`${key.id}-${scope}`} className={SETTINGS_BADGE_ITEM_CLASSES}>
                            {scope}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={SETTINGS_SECONDARY_BUTTON_CLASSES}
                          onClick={async () => {
                            await navigator.clipboard.writeText(key.prefix);
                          }}
                        >
                          Copy prefix
                        </button>
                        {status === 'active' ? (
                          <button
                            type="button"
                            className={classNames(SETTINGS_DANGER_BUTTON_CLASSES, getStatusToneClasses('danger'))}
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
          </>
        )}
      </section>

      <section className={classNames(SETTINGS_CARD_CONTAINER_CLASSES, "gap-4")}>
        <div className="flex flex-col gap-2">
          <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>Browser API token override</h3>
          <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>
          Paste an API key token here to send it with subsequent API requests from this browser. Leave the field empty to
          rely on your signed-in session.
          </p>
        </div>
        <label className={SETTINGS_FORM_LABEL_CLASSES}>
          Active token
          <input
            type="text"
            value={activeToken ?? ''}
            onChange={(event) => setActiveToken(event.target.value.trim() ? event.target.value.trim() : null)}
            placeholder="apphub_live_…"
            autoComplete="off"
            className={SETTINGS_FORM_INPUT_CLASSES}
          />
        </label>
        <button
          type="button"
          className={SETTINGS_SECONDARY_BUTTON_CLASSES}
          onClick={() => setActiveToken(null)}
        >
          Clear token override
        </button>
      </section>
    </section>
  );
}
