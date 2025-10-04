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
import {
  BODY_TEXT,
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
  TAG_BADGE_STRONG,
  TEXTAREA,
  SECTION_LABEL
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
};

export default function ImportAppsTab({ onAppRegistered, onViewCore }: ImportAppsTabProps) {
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

  const repoHistory = useMemo(() => history, [history]);

  const draftStatus = useMemo(() => {
    if (!draftSavedAt) {
      return null;
    }
    return `draft saved ${formatRelativeTime(draftSavedAt) ?? 'recently'}`;
  }, [draftSavedAt]);

  const renderHistory = (app: AppRecord | null) => {
    if (!app) {
      return null;
    }

    const statusBadge = resolveStatusBadge(app.ingestStatus);

    return (
      <div className={`${CARD_SECTION} gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className={SECTION_LABEL}>Ingestion status</span>
            <div className="flex items-center gap-2">
              <span className={statusBadge}>{app.ingestStatus}</span>
              {app.ingestError ? <span className={STATUS_MESSAGE}>{app.ingestError}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <FormButton size="sm" type="button" variant="secondary" onClick={resetForm}>
              New app
            </FormButton>
            {onViewCore ? (
              <FormButton size="sm" type="button" onClick={() => onViewCore()}>
                View in catalog
              </FormButton>
            ) : null}
            <FormButton size="sm" type="button" variant="secondary" onClick={() => fetchHistory(app.id)}>
              Refresh history
            </FormButton>
          </div>
        </div>
        {historyLoading ? (
          <div className="flex items-center gap-2 text-scale-sm text-secondary">
            <Spinner size="xs" label="Loading" />
            <span>Fetching ingestion history...</span>
          </div>
        ) : historyError ? (
          <FormFeedback tone="error">{historyError}</FormFeedback>
        ) : repoHistory.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className={SECTION_LABEL}>Recent ingestion events</span>
            <ul className="space-y-2 text-scale-sm text-secondary">
              {repoHistory.map((event: IngestionEvent) => (
                <li key={event.id} className="flex flex-col gap-1 rounded-xl bg-surface-glass-soft p-3">
                  <div className="flex items-center gap-2">
                    <span className={resolveStatusBadge(event.status)}>{event.status}</span>
                    <span className={STATUS_META}>{new Date(event.createdAt).toLocaleString()}</span>
                  </div>
                  {event.message ? <p>{event.message}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={STATUS_META}>No ingestion history for this app yet.</p>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
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
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={segmentedButtonClass(sourceType === 'remote')}
            onClick={() => setSourceType('remote')}
          >
            Remote repository
          </button>
          <button
            type="button"
            className={segmentedButtonClass(sourceType === 'local')}
            onClick={() => setSourceType('local')}
          >
            Local workspace
          </button>
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
        <FormField label="Description" htmlFor="app-description">
          <textarea
            id="app-description"
            className={TEXTAREA}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Describe the application so teammates recognize it in the catalog"
            required
          />
        </FormField>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Repository URL" htmlFor="app-repo">
            <input
              id="app-repo"
              className={INPUT}
              value={form.repoUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, repoUrl: event.target.value }))}
              placeholder="https://github.com/user/project"
              required
            />
          </FormField>
          <FormField label="Dockerfile path" htmlFor="app-dockerfile">
            <input
              id="app-dockerfile"
              className={INPUT}
              value={form.dockerfilePath}
              onChange={(event) => setForm((prev) => ({ ...prev, dockerfilePath: event.target.value }))}
              placeholder="services/my-app/Dockerfile"
              required
            />
          </FormField>
        </div>
        <div className="flex flex-col gap-2">
          <span className={SECTION_LABEL}>Tags</span>
          <p className={STATUS_META}>Tags help filter catalog listings. Keep values lowercase.</p>
          <div className="flex flex-col gap-3">
            {form.tags.map((tag, index) => (
              <div key={`${tag.key}-${index}`} className="flex gap-2">
                <input
                  className={`${INPUT} max-w-xs`}
                  value={tag.key}
                  onChange={(event) => handleTagChange(index, 'key', event.target.value)}
                  placeholder="language"
                />
                <input
                  className={`${INPUT} max-w-sm`}
                  value={tag.value}
                  onChange={(event) => handleTagChange(index, 'value', event.target.value)}
                  placeholder="typescript"
                />
                <button type="button" className={`${SECONDARY_BUTTON} whitespace-nowrap`} onClick={() => removeTagField(index)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className={SECONDARY_BUTTON} onClick={addTagField}>
              Add tag
            </button>
          </div>
        </div>
        <FormField label="Metadata strategy" htmlFor="app-metadata">
          <select
            id="app-metadata"
            className={INPUT}
            value={form.metadataStrategy}
            onChange={(event) => setForm((prev) => ({ ...prev, metadataStrategy: event.target.value as 'auto' | 'explicit' }))}
          >
            <option value="auto">Auto (metadata extracted from repo)</option>
            <option value="explicit">Explicit (metadata defined in manifest)</option>
          </select>
        </FormField>
        {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
        <FormActions>
          <FormButton type="submit" disabled={submitting || disableSubmit}>
            {submitting ? 'Submitting...' : 'Register app'}
          </FormButton>
          <FormButton type="button" variant="secondary" onClick={resetForm}>
            Reset form
          </FormButton>
          <FormButton type="button" variant="secondary" onClick={clearDraft}>
            Clear draft
          </FormButton>
        </FormActions>
      </FormSection>

      <div className="flex flex-col gap-4">
        {renderHistory(currentApp)}
      </div>
    </div>
  );
}
