import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components';
import StatusBadge from './StatusBadge';
import { formatDuration, formatTimestamp } from '../formatters';
import type { WorkflowDefinition, WorkflowRuntimeSummary } from '../types';
import { ROUTE_PATHS } from '../../routes/paths';

type WorkflowDetailsCardProps = {
  workflow: WorkflowDefinition | null;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  onEdit: () => void;
  runtimeSummary?: WorkflowRuntimeSummary;
  onLaunch?: () => void;
  canLaunch?: boolean;
  launchDisabledReason?: string;
  launchWarning?: string | null;
};

const CARD_CONTAINER_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';
const CARD_HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';
const CARD_MESSAGE_TEXT_CLASSES = 'mt-3 text-scale-sm text-secondary';
const CARD_ERROR_TEXT_CLASSES = 'mt-3 text-scale-sm font-weight-semibold text-status-danger';
const CARD_DESCRIPTION_TEXT_CLASSES = 'text-scale-sm text-secondary';
const CARD_META_TEXT_CLASSES = 'mt-1 text-scale-xs text-muted';
const STEP_SECTION_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';
const STEP_ITEM_CLASSES = 'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-sm text-secondary';
const STEP_META_TEXT_CLASSES = 'text-scale-xs text-muted';
const STEP_VIEW_JOB_BUTTON_CLASSES =
  'self-start rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const ACTION_PRIMARY_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-1.5 text-scale-xs font-weight-semibold text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';
const ACTION_SECONDARY_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent-soft px-4 py-1.5 text-scale-xs font-weight-semibold text-accent transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';
const SUMMARY_CARD_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-4 text-scale-sm shadow-elevation-sm transition-colors';
const SUMMARY_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.28em] text-muted';
const SUMMARY_VALUE_PRIMARY_CLASSES = 'mt-2 text-scale-sm font-weight-semibold text-primary';
const SUMMARY_VALUE_SECONDARY_CLASSES = 'text-scale-xs text-muted';
const WARNING_TEXT_CLASSES = 'mt-2 text-scale-xs font-weight-semibold text-status-warning';

export default function WorkflowDetailsCard({
  workflow,
  loading,
  error,
  canEdit,
  onEdit,
  runtimeSummary,
  onLaunch,
  canLaunch = false,
  launchDisabledReason,
  launchWarning
}: WorkflowDetailsCardProps) {
  const navigate = useNavigate();
  const hasRuns = Boolean(runtimeSummary?.runId);
  const lastRunTimestamp = runtimeSummary?.completedAt ?? runtimeSummary?.startedAt ?? null;
  const durationLabel = formatDuration(runtimeSummary?.durationMs ?? null);

  const handleViewJob = (slug: string) => {
    const params = new URLSearchParams({ job: slug });
    navigate(`${ROUTE_PATHS.jobs}?${params.toString()}`);
  };

  return (
    <section className={CARD_CONTAINER_CLASSES}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={CARD_HEADER_TITLE_CLASSES}>Workflow Details</h2>
          {workflow?.description ? (
            <p className={`${CARD_DESCRIPTION_TEXT_CLASSES} mt-1`}>{workflow.description}</p>
          ) : null}
          <p className={CARD_META_TEXT_CLASSES}>
            {workflow?.triggers.length
              ? `Triggers: ${workflow.triggers.map((trigger) => trigger.type).join(', ')}`
              : 'Triggers: manual'}
          </p>
        </div>
        {workflow && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={ACTION_PRIMARY_BUTTON_CLASSES}
              onClick={onLaunch}
              disabled={!onLaunch || !canLaunch}
              title={!canLaunch && launchDisabledReason ? launchDisabledReason : undefined}
            >
              Launch workflow
            </button>
            <button
              type="button"
              className={ACTION_SECONDARY_BUTTON_CLASSES}
              onClick={onEdit}
              disabled={!canEdit}
              title={canEdit ? undefined : 'Insufficient scope: workflows:write required to edit workflows.'}
            >
              Edit workflow
            </button>
            {launchWarning && <p className={WARNING_TEXT_CLASSES}>{launchWarning}</p>}
          </div>
        )}
      </div>
      {loading && (
        <p className={CARD_MESSAGE_TEXT_CLASSES}>
          <Spinner label="Loading workflow details…" size="xs" />
        </p>
      )}
      {error && !loading && <p className={CARD_ERROR_TEXT_CLASSES}>{error}</p>}
      {!loading && !error && workflow && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className={SUMMARY_CARD_CLASSES}>
              <span className={SUMMARY_LABEL_CLASSES}>Latest run</span>
              {hasRuns ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={runtimeSummary?.status ?? 'unknown'} />
                    <span className={SUMMARY_VALUE_SECONDARY_CLASSES}>
                      {formatTimestamp(lastRunTimestamp ?? null)}
                    </span>
                  </div>
                  <span className={SUMMARY_VALUE_SECONDARY_CLASSES}>Run ID: {runtimeSummary?.runId ?? '—'}</span>
                  <span className={SUMMARY_VALUE_SECONDARY_CLASSES}>Run key: {runtimeSummary?.runKey ?? '—'}</span>
                </div>
              ) : (
                <span className={SUMMARY_VALUE_PRIMARY_CLASSES}>No runs recorded yet.</span>
              )}
            </div>
            <div className={SUMMARY_CARD_CLASSES}>
              <span className={SUMMARY_LABEL_CLASSES}>Run metadata</span>
              <div className="mt-3 flex flex-col gap-1">
                <span className={SUMMARY_VALUE_SECONDARY_CLASSES}>
                  Triggered by: {runtimeSummary?.triggeredBy ?? '—'}
                </span>
                <span className={SUMMARY_VALUE_SECONDARY_CLASSES}>Duration: {durationLabel}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className={STEP_SECTION_TITLE_CLASSES}>Steps</h3>
            <ol className="mt-3 flex flex-col gap-2">
              {workflow.steps.map((step, index) => (
                <li key={step.id} className={STEP_ITEM_CLASSES}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-weight-semibold text-primary">
                          {index + 1}. {step.name}
                        </span>
                        <span className={STEP_META_TEXT_CLASSES}>
                          {step.serviceSlug ?? step.jobSlug ?? step.type ?? 'step'}
                        </span>
                      </div>
                      {step.description && (
                        <p className={`${STEP_META_TEXT_CLASSES} mt-1`}>{step.description}</p>
                      )}
                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <p className={`${STEP_META_TEXT_CLASSES} mt-1`}>
                          Depends on: {step.dependsOn.join(', ')}
                        </p>
                      )}
                    </div>
                    {step.jobSlug && (
                      <button
                        type="button"
                        className={STEP_VIEW_JOB_BUTTON_CLASSES}
                        onClick={() => handleViewJob(step.jobSlug!)}
                      >
                        View job
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
