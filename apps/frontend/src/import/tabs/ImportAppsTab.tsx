import { useEffect, useMemo, useRef } from 'react';
import {
  FormActions,
  FormButton,
  FormField,
  FormFeedback,
  FormSection
} from '../../components/form';
import { Spinner } from '../../components';
import { useToasts } from '../../components/toast';
import { type AppRecord, type IngestionEvent, useImportApp } from '../useImportApp';
import type { AppScenario } from '../examples';
import { ScenarioSwitcher } from '../components/ScenarioSwitcher';

const INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30';

const TEXTAREA_CLASSES = `${INPUT_CLASSES} min-h-[120px] resize-y`;

const TOGGLE_BUTTON_BASE =
  'inline-flex flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const TOGGLE_BUTTON_ACTIVE = `${TOGGLE_BUTTON_BASE} bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-slate-200/20 dark:text-slate-50`;

const TOGGLE_BUTTON_INACTIVE = `${TOGGLE_BUTTON_BASE} bg-white/70 text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const TAG_BUTTON_CLASSES = 'mt-2 inline-flex flex-wrap gap-2';

const HISTORY_CONTAINER_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60';

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]';

const STATUS_VARIANTS: Record<string, string> = {
  ready:
    'border-emerald-400/70 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-200',
  failed:
    'border-rose-400/70 bg-rose-500/15 text-rose-700 dark:border-rose-400/60 dark:bg-rose-500/20 dark:text-rose-200',
  processing:
    'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200',
  pending:
    'border-amber-300/70 bg-amber-50/80 text-amber-700 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200',
  seed: 'border-slate-300/70 bg-slate-100/70 text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200'
};

const APP_DOC_URL = 'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#apps';

function getStatusBadge(status: string) {
  return `${STATUS_BADGE_BASE} ${STATUS_VARIANTS[status] ?? STATUS_VARIANTS.pending}`;
}

function formatRelativeTime(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }
  const diffMs = Date.now() - timestamp;
  if (diffMs < 45_000) {
    return 'moments ago';
  }
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

type ImportAppsTabProps = {
  onAppRegistered?: (id: string) => void;
  onViewCatalog?: () => void;
  scenario?: AppScenario | null;
  scenarioRequestToken?: number;
  onScenarioCleared?: () => void;
  scenarioOptions?: { id: string; title: string }[];
  activeScenarioId?: string | null;
  onScenarioSelected?: (id: string) => void;
};

export default function ImportAppsTab({
  onAppRegistered,
  onViewCatalog,
  scenario,
  scenarioRequestToken,
  onScenarioCleared,
  scenarioOptions,
  activeScenarioId,
  onScenarioSelected
}: ImportAppsTabProps) {
  const {
    form,
    setForm,
    sourceType,
    setSourceType,
    submitting,
    submissionVersion,
    error,
    errorVersion,
    currentApp,
    history,
    historyLoading,
    historyError,
    disableSubmit,
    handleSubmit,
    handleTagChange,
    addTagField,
    removeTagField,
    fetchHistory,
    resetForm,
    clearDraft,
    draftSavedAt
  } = useImportApp(onAppRegistered);
  const { pushToast } = useToasts();
  const lastSubmissionVersion = useRef(0);
  const lastErrorVersion = useRef(0);

  useEffect(() => {
    if (!scenario || typeof scenarioRequestToken === 'undefined') {
      return;
    }
    resetForm();
    const nextTags =
      scenario.form.tags && scenario.form.tags.length > 0
        ? scenario.form.tags
        : [{ key: 'language', value: 'typescript' }];
    setForm({
      id: scenario.form.id ?? '',
      name: scenario.form.name,
      description: scenario.form.description,
      repoUrl: scenario.form.repoUrl,
      dockerfilePath: scenario.form.dockerfilePath,
      tags: nextTags,
      metadataStrategy: scenario.form.metadataStrategy ?? 'auto'
    });
    setSourceType(scenario.form.sourceType ?? 'remote');
  }, [resetForm, scenario, scenarioRequestToken, setForm, setSourceType]);

  useEffect(() => {
    if (submissionVersion === 0 || submissionVersion === lastSubmissionVersion.current) {
      return;
    }
    const appName = currentApp?.name ?? form.name;
    pushToast({
      tone: 'success',
      title: 'App registration submitted',
      description: appName ? `AppHub queued ingestion for ${appName}.` : 'AppHub queued ingestion for the new app.'
    });
    lastSubmissionVersion.current = submissionVersion;
  }, [currentApp?.name, form.name, pushToast, submissionVersion]);

  useEffect(() => {
    if (!error || errorVersion === lastErrorVersion.current) {
      return;
    }
    pushToast({ tone: 'error', title: 'App registration failed', description: error });
    lastErrorVersion.current = errorVersion;
  }, [error, errorVersion, pushToast]);

  const draftStatus = useMemo(() => formatRelativeTime(draftSavedAt), [draftSavedAt]);

  const handleClearDraft = () => {
    clearDraft();
  };

  const renderHistory = (events: IngestionEvent[]) => {
    if (events.length === 0) {
      return <p className="text-sm text-slate-500 dark:text-slate-400">No ingestion events yet.</p>;
    }
    return (
      <ul className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300">
        {events.map((event) => (
          <li
            key={event.id}
            className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/60"
          >
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={getStatusBadge(event.status)}>{event.status}</span>
              <time className="text-slate-500 dark:text-slate-400" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
              {event.commitSha && (
                <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  {event.commitSha.slice(0, 10)}
                </code>
              )}
            </div>
            <div className="mt-2 space-y-2">
              <div className="font-medium text-slate-700 dark:text-slate-200">
                {event.message ?? 'No additional message'}
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                {event.attempt !== null && <span>Attempt {event.attempt}</span>}
                {typeof event.durationMs === 'number' && <span>{`${Math.max(event.durationMs, 0)} ms`}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const renderSummary = (app: AppRecord | null) => {
    if (!app) {
      return (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
          <p>
            Register a repository to make it discoverable in the catalog. AppHub will clone the repository, queue an
            ingestion run, and surface build history alongside detected integrations.
          </p>
          <a
            className="inline-flex items-center gap-1 text-sm font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
            href={APP_DOC_URL}
            target="_blank"
            rel="noreferrer"
          >
            View app onboarding guide
            <span aria-hidden="true">→</span>
          </a>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500 dark:text-emerald-300">
            Registration queued
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{app.name}</h2>
            <span className={getStatusBadge(app.ingestStatus)}>{app.ingestStatus}</span>
          </div>
          {app.ingestError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{app.ingestError}</p>
          )}
        </div>
        <dl className="grid gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              App slug
            </dt>
            <dd className="font-mono text-xs text-slate-700 dark:text-slate-200">{app.id}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Repository
            </dt>
            <dd className="break-all font-mono text-xs text-slate-700 dark:text-slate-200">{app.repoUrl}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Dockerfile
            </dt>
            <dd className="font-mono text-xs text-slate-700 dark:text-slate-200">{app.dockerfilePath}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Tags
            </dt>
            <dd className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
              {app.tags.length > 0
                ? app.tags.map((tag) => (
                    <span
                      key={`${tag.key}:${tag.value}`}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-200/70 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700/60 dark:text-slate-200"
                    >
                      {tag.key}
                      <span className="text-slate-400">:</span>
                      {tag.value}
                    </span>
                  ))
                : 'None'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Metadata strategy
            </dt>
            <dd className="text-xs text-slate-600 dark:text-slate-300">
              {app.metadataStrategy === 'explicit' ? 'Use provided values' : 'Auto-discover' }
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <FormButton
            size="sm"
            onClick={() => {
              onViewCatalog?.();
            }}
            type="button"
          >
            View in catalog
          </FormButton>
          <FormButton size="sm" variant="secondary" type="button" onClick={() => fetchHistory(app.id)}>
            Refresh history
          </FormButton>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      {scenario ? (
        <div className="rounded-2xl border border-violet-300/70 bg-violet-50/70 p-4 text-sm text-slate-700 shadow-sm dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-600 dark:text-violet-300">
                Example scenario active
              </span>
              <p>
                Fields prefilled from <strong>{scenario.title}</strong>. Fine-tune anything before submitting.
              </p>
              {(scenario.requiresServices?.length || scenario.requiresApps?.length) && (
                <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {scenario.requiresServices?.length ? (
                    <li>
                      <strong>Requires services:</strong> {scenario.requiresServices.join(', ')}
                    </li>
                  ) : null}
                  {scenario.requiresApps?.length ? (
                    <li>
                      <strong>Requires apps:</strong> {scenario.requiresApps.join(', ')}
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
            {onScenarioCleared && (
              <button
                type="button"
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-600 shadow-sm transition hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-slate-800"
                onClick={onScenarioCleared}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      ) : null}
      <ScenarioSwitcher options={scenarioOptions ?? []} activeId={activeScenarioId ?? null} onSelect={onScenarioSelected} />
      <FormSection as="form" onSubmit={handleSubmit} aria-label="Register application">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Application details</h2>
          {draftStatus && (
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
              Draft saved {draftStatus}
            </span>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200">
          <p className="leading-relaxed">
            <strong>Apps</strong> represent container workloads that AppHub builds from a Dockerfile. Provide the repository URL
            and the Dockerfile path relative to the repo root. For registering network endpoints or shared manifests, use the
            <span className="font-semibold"> Service manifests</span> tab.
          </p>
          <a
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
            href={APP_DOC_URL}
            target="_blank"
            rel="noreferrer"
          >
            View app onboarding guide
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <FormField label="Application name" htmlFor="app-name">
          <input
            id="app-name"
            className={INPUT_CLASSES}
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="My Awesome App"
            required
          />
        </FormField>
        <FormField label="Application ID" htmlFor="app-id" hint="Optional – auto-generated from name">
          <input
            id="app-id"
            className={INPUT_CLASSES}
            value={form.id}
            onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
            placeholder="leave blank to auto-generate"
            pattern="[a-z][a-z0-9-]{2,63}"
            title="Use lowercase letters, numbers, and dashes. Must start with a letter and be at least 3 characters."
          />
        </FormField>
        <FormField label="Description" htmlFor="app-description">
          <textarea
            id="app-description"
            className={TEXTAREA_CLASSES}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Short summary shown in the catalog"
            required
          />
        </FormField>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Repository source</span>
          <div className="flex gap-2 rounded-full border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/60 dark:bg-slate-800/60">
            <button
              type="button"
              className={sourceType === 'remote' ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE}
              onClick={() => setSourceType('remote')}
            >
              Remote (git/https)
            </button>
            <button
              type="button"
              className={sourceType === 'local' ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE}
              onClick={() => setSourceType('local')}
            >
              Local path
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Metadata strategy</span>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Auto-discover pulls name, description, and tags from package manifests and README files. Use provided values to keep the details you enter here.
          </p>
          <div className="flex gap-2 rounded-full border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/60 dark:bg-slate-800/60">
            <button
              type="button"
              className={form.metadataStrategy === 'auto' ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE}
              onClick={() => setForm((prev) => ({ ...prev, metadataStrategy: 'auto' }))}
            >
              Auto-discover
            </button>
            <button
              type="button"
              className={form.metadataStrategy === 'explicit' ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE}
              onClick={() => setForm((prev) => ({ ...prev, metadataStrategy: 'explicit' }))}
            >
              Use provided values
            </button>
          </div>
        </div>
        <FormField
          label="Repository URL or path"
          htmlFor="repo-url"
          hint={
            sourceType === 'local'
              ? 'Provide an absolute path to a Git repository on this machine.'
              : 'Provide a cloneable Git URL (https://, git@, etc.).'
          }
        >
          <input
            id="repo-url"
            className={INPUT_CLASSES}
            value={form.repoUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, repoUrl: event.target.value }))}
            placeholder={
              sourceType === 'local' ? '/absolute/path/to/repo' : 'https://github.com/user/project.git'
            }
            required
          />
        </FormField>
        <FormField
          label="Dockerfile path"
          htmlFor="dockerfile-path"
          hint="Relative to the repository root, e.g. services/api/Dockerfile"
        >
          <input
            id="dockerfile-path"
            className={INPUT_CLASSES}
            value={form.dockerfilePath}
            onChange={(event) => setForm((prev) => ({ ...prev, dockerfilePath: event.target.value }))}
            placeholder="Dockerfile"
            required
            pattern="(?:(?!\\.\\.).)*(Dockerfile(\\.[^/]+)?)$"
            title="Provide a repository-relative path ending in Dockerfile. Parent directory segments (..) are not allowed."
          />
        </FormField>
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tags</span>
          <div className="flex flex-col gap-3">
            {form.tags.map((tag, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3">
                <input
                  className={`${INPUT_CLASSES} flex-1 min-w-[120px]`}
                  value={tag.key}
                  onChange={(event) => handleTagChange(index, 'key', event.target.value)}
                  placeholder="key"
                />
                <span className="text-lg font-semibold text-slate-400 dark:text-slate-500">:</span>
                <input
                  className={`${INPUT_CLASSES} flex-1 min-w-[160px]`}
                  value={tag.value}
                  onChange={(event) => handleTagChange(index, 'value', event.target.value)}
                  placeholder="value"
                />
                {form.tags.length > 1 && (
                  <FormButton
                    type="button"
                    size="sm"
                    variant="tertiary"
                    onClick={() => removeTagField(index)}
                  >
                    Remove
                  </FormButton>
                )}
              </div>
            ))}
          </div>
          <div className={TAG_BUTTON_CLASSES}>
            <FormButton type="button" size="sm" variant="tertiary" onClick={addTagField}>
              Add tag
            </FormButton>
          </div>
        </div>
        <FormActions>
          <FormButton type="submit" disabled={disableSubmit}>
            {submitting ? 'Submitting…' : 'Register application'}
          </FormButton>
          <FormButton type="button" variant="secondary" size="sm" onClick={resetForm}>
            Start new registration
          </FormButton>
          <FormButton type="button" variant="tertiary" size="sm" onClick={handleClearDraft}>
            Clear draft
          </FormButton>
        </FormActions>
        {error && <FormFeedback tone="error">{error}</FormFeedback>}
      </FormSection>

      <FormSection>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Registration status</h2>
        {renderSummary(currentApp)}
        <div className={HISTORY_CONTAINER_CLASSES}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Ingestion history</h3>
            {currentApp && (
              <button
                type="button"
                className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
                onClick={() => fetchHistory(currentApp.id)}
              >
                Refresh
              </button>
            )}
          </div>
          {historyLoading && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <Spinner label="Loading history…" size="xs" />
            </p>
          )}
          {historyError && <FormFeedback tone="error">{historyError}</FormFeedback>}
          {!historyLoading && !historyError && renderHistory(history)}
        </div>
      </FormSection>
    </div>
  );
}
