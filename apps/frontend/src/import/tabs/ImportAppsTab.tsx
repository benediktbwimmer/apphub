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
import {
  BODY_TEXT,
  CARD_SURFACE_ACTIVE,
  CARD_SECTION,
  HEADING_SECONDARY,
  INPUT,
  LINK_ACCENT,
  SECONDARY_BUTTON,
  SEGMENTED_BUTTON_ACTIVE,
  SEGMENTED_BUTTON_BASE,
  SEGMENTED_BUTTON_INACTIVE,
  STATUS_BADGE_DANGER,
  STATUS_BADGE_INFO,
  STATUS_BADGE_NEUTRAL,
  STATUS_BADGE_SUCCESS,
  STATUS_BADGE_WARNING,
  STATUS_MESSAGE,
  STATUS_META,
  TAG_BADGE,
  TAG_BADGE_STRONG,
  TEXTAREA,
  SECTION_LABEL,
} from '../importTokens';

const segmentedButtonClass = (active: boolean) =>
  `${SEGMENTED_BUTTON_BASE} ${active ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE}`;

const STATUS_BADGE_MAP: Record<string, string> = {
  ready: STATUS_BADGE_SUCCESS,
  failed: STATUS_BADGE_DANGER,
  processing: STATUS_BADGE_INFO,
  pending: STATUS_BADGE_WARNING,
  seed: TAG_BADGE_STRONG
};

const resolveStatusBadge = (status: string) => STATUS_BADGE_MAP[status] ?? STATUS_BADGE_NEUTRAL;

const APP_DOC_URL = 'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#apps';

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
  onViewCore?: () => void;
  scenario?: AppScenario | null;
  scenarioRequestToken?: number;
  onScenarioCleared?: () => void;
  scenarioOptions?: { id: string; title: string }[];
  activeScenarioId?: string | null;
  onScenarioSelected?: (id: string) => void;
};

export default function ImportAppsTab({
  onAppRegistered,
  onViewCore,
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
      return <p className={STATUS_MESSAGE}>No ingestion events yet.</p>;
    }
    return (
      <ul className="flex flex-col gap-3 text-scale-sm text-secondary">
        {events.map((event) => (
          <li key={event.id} className={`${CARD_SECTION} gap-2`}>
            <div className="flex flex-wrap items-center gap-3 text-scale-xs text-secondary">
              <span className={resolveStatusBadge(event.status)}>{event.status}</span>
              <time className={STATUS_META} dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
              {event.commitSha ? (
                <code className="rounded-full bg-surface-muted px-2.5 py-1 font-mono text-scale-2xs text-secondary">
                  {event.commitSha.slice(0, 10)}
                </code>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="font-weight-medium text-primary">
                {event.message ?? 'No additional message'}
              </div>
              <div className="flex flex-wrap gap-3 text-scale-xs text-muted">
                {event.attempt !== null ? <span>Attempt {event.attempt}</span> : null}
                {typeof event.durationMs === 'number' ? <span>{`${Math.max(event.durationMs, 0)} ms`}</span> : null}
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
        <div className={`${CARD_SECTION} text-scale-sm`}>
          <p className={BODY_TEXT}>
            Register a repository to make it discoverable in the catalog. AppHub will clone the repository, queue an
            ingestion run, and surface build history alongside detected integrations.
          </p>
          <a className={LINK_ACCENT} href={APP_DOC_URL} target="_blank" rel="noreferrer">
            View app onboarding guide
            <span aria-hidden="true">→</span>
          </a>
        </div>
      );
    }

    return (
      <div className={`${CARD_SECTION} gap-4`}>
        <div className="flex flex-col gap-2">
          <span className={SECTION_LABEL}>Registration queued</span>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className={HEADING_SECONDARY}>{app.name}</h2>
            <span className={resolveStatusBadge(app.ingestStatus)}>{app.ingestStatus}</span>
          </div>
          {app.ingestError ? (
            <p className="text-scale-sm font-weight-medium text-status-danger">{app.ingestError}</p>
          ) : null}
        </div>
        <dl className="grid gap-3 text-scale-sm text-secondary sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>App slug</dt>
            <dd className="font-mono text-scale-xs text-primary">{app.id}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Repository</dt>
            <dd className="break-all font-mono text-scale-xs text-primary">{app.repoUrl}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Dockerfile</dt>
            <dd className="font-mono text-scale-xs text-primary">{app.dockerfilePath}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Tags</dt>
            <dd className="flex flex-wrap gap-2 text-scale-xs text-secondary">
              {app.tags.length > 0
                ? app.tags.map((tag) => (
                    <span key={`${tag.key}:${tag.value}`} className={TAG_BADGE}>
                      {tag.key}
                      <span aria-hidden="true">:</span>
                      {tag.value}
                    </span>
                  ))
                : 'None'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Metadata strategy</dt>
            <dd className={STATUS_MESSAGE}>
              {app.metadataStrategy === 'explicit' ? 'Use provided values' : 'Auto-discover'}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <FormButton size="sm" type="button" onClick={() => onViewCore?.()}>
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
        <div className={`${CARD_SECTION} ${CARD_SURFACE_ACTIVE} gap-2`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1 text-scale-sm text-secondary">
              <span className={SECTION_LABEL}>Example scenario active</span>
              <p className={BODY_TEXT}>
                Fields prefilled from <strong>{scenario.title}</strong>. Fine-tune anything before submitting.
              </p>
            </div>
            {onScenarioCleared ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={onScenarioCleared}>
                Reset
              </button>
            ) : null}
          </div>
          {(scenario.requiresServices?.length || scenario.requiresApps?.length) ? (
            <ul className="space-y-1 text-scale-xs text-secondary">
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
          ) : null}
        </div>
      ) : null}
      <ScenarioSwitcher options={scenarioOptions ?? []} activeId={activeScenarioId ?? null} onSelect={onScenarioSelected} />
      <FormSection as="form" onSubmit={handleSubmit} aria-label="Register application">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={HEADING_SECONDARY}>Application details</h2>
          {draftStatus ? <span className={STATUS_META}>Draft saved {draftStatus}</span> : null}
        </div>
        <div className={`${CARD_SECTION} text-scale-sm`}>
          <p className={BODY_TEXT}>
            <strong>Apps</strong> represent container workloads that AppHub builds from a Dockerfile. Provide the repository URL
            and the Dockerfile path relative to the repo root. For registering network endpoints or shared manifests, use the
            <strong> Service manifests</strong> tab.
          </p>
          <a className={LINK_ACCENT} href={APP_DOC_URL} target="_blank" rel="noreferrer">
            View app onboarding guide
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <FormField label="Application name" htmlFor="app-name">
          <input
            id="app-name"
            className={INPUT}
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="My Awesome App"
            required
          />
        </FormField>
        <FormField label="Application ID" htmlFor="app-id" hint="Optional – auto-generated from name">
          <input
            id="app-id"
            className={INPUT}
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
            className={TEXTAREA}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Short summary shown in the core"
            required
          />
        </FormField>
        <div className="flex flex-col gap-2">
          <span className={HEADING_SECONDARY}>Repository source</span>
          <div className="flex gap-2 rounded-full border border-subtle bg-surface-glass-soft p-1">
            <button
              type="button"
              className={segmentedButtonClass(sourceType === 'remote')}
              onClick={() => setSourceType('remote')}
            >
              Remote (git/https)
            </button>
            <button
              type="button"
              className={segmentedButtonClass(sourceType === 'local')}
              onClick={() => setSourceType('local')}
            >
              Local path
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className={HEADING_SECONDARY}>Metadata strategy</span>
          <p className={STATUS_MESSAGE}>
            Auto-discover pulls name, description, and tags from package manifests and README files. Use provided values to keep the details you enter here.
          </p>
          <div className="flex gap-2 rounded-full border border-subtle bg-surface-glass-soft p-1">
            <button
              type="button"
              className={segmentedButtonClass(form.metadataStrategy === 'auto')}
              onClick={() => setForm((prev) => ({ ...prev, metadataStrategy: 'auto' }))}
            >
              Auto-discover
            </button>
            <button
              type="button"
              className={segmentedButtonClass(form.metadataStrategy === 'explicit')}
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
            className={INPUT}
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
            className={INPUT}
            value={form.dockerfilePath}
            onChange={(event) => setForm((prev) => ({ ...prev, dockerfilePath: event.target.value }))}
            placeholder="Dockerfile"
            required
            pattern="(?:(?!\\.\\.).)*(Dockerfile(\\.[^/]+)?)$"
            title="Provide a repository-relative path ending in Dockerfile. Parent directory segments (..) are not allowed."
          />
        </FormField>
        <div className="flex flex-col gap-3">
          <span className={HEADING_SECONDARY}>Tags</span>
          <div className="flex flex-col gap-3">
            {form.tags.map((tag, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3">
                <input
                  className={`${INPUT} flex-1 min-w-[120px]`}
                  value={tag.key}
                  onChange={(event) => handleTagChange(index, 'key', event.target.value)}
                  placeholder="key"
                />
                <span className="text-scale-lg font-weight-semibold text-muted">:</span>
                <input
                  className={`${INPUT} flex-1 min-w-[160px]`}
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
          <div className="mt-2 flex flex-wrap gap-2">
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
        <h2 className={HEADING_SECONDARY}>Registration status</h2>
        {renderSummary(currentApp)}
        <div className={`${CARD_SECTION} gap-3`}>
          <div className="flex items-center justify-between">
            <h3 className={HEADING_SECONDARY}>Ingestion history</h3>
            {currentApp && (
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => fetchHistory(currentApp.id)}
              >
                Refresh
              </button>
            )}
          </div>
          {historyLoading && (
            <p className={STATUS_MESSAGE}>
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
