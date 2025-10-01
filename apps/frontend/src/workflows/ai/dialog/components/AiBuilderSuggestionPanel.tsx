import { getStatusToneClasses } from '../../../../theme/statusTokens';
import type { AiBuilderDialogHandlers, AiBuilderDialogState, JobDraft } from '../types';
import { formatSummary } from '../utils';

const PANEL_SECTION = 'flex flex-col gap-4';

const DIVIDER_CARD =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-xs text-secondary shadow-elevation-sm transition-colors';

const SECTION_CARD = 'rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-sm transition-colors';

const SECTION_LABEL = 'mt-3 block text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

const TEXTAREA_BASE =
  'mt-1 w-full rounded-2xl border border-subtle bg-surface-muted p-3 text-scale-xs leading-relaxed text-primary shadow-elevation-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70';

const PRIMARY_ACTION_SMALL =
  'rounded-full border border-accent bg-accent px-3 py-1.5 text-scale-xs font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_ACTION_MEDIUM =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-1.5 text-scale-xs font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_SUBMIT_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-full border border-accent bg-accent px-5 py-2 text-scale-sm font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const SECONDARY_BUTTON =
  'rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-muted';

const STATUS_TEXT_PENDING = 'text-muted';
const STATUS_TEXT_READY = 'text-accent';
const STATUS_TEXT_SUCCESS = 'text-status-success';

const CODE_CHIP = 'rounded bg-surface-muted px-1 py-[2px] font-mono text-[10px] text-primary';

type Props = {
  state: Pick<
    AiBuilderDialogState,
    |
      'editorValue'
    | 'hasSuggestion'
    | 'pending'
    | 'submitting'
    | 'validation'
    | 'mode'
    | 'plan'
    | 'jobDrafts'
    | 'bundleValidation'
    | 'metadataSummary'
    | 'summaryText'
    | 'workflowNotes'
    | 'providerHasLogs'
    | 'stdout'
    | 'stderr'
    | 'generation'
    | 'providerLogTitle'
    | 'activeProviderLabel'
    | 'isEdited'
    | 'canSubmit'
    | 'bundleValidation'
    | 'canCreateJob'
    | 'providerRequiresKey'
  >;
  handlers: Pick<
    AiBuilderDialogHandlers,
    |
      'handleEditorChange'
    | 'handleOpenInBuilder'
    | 'handleSubmitWorkflow'
    | 'handleSubmitJob'
    | 'handleJobDraftChange'
    | 'handleJobPromptChange'
    | 'handleGenerateDependency'
    | 'handleCreateDraftJob'
  >;
};

export function AiBuilderSuggestionPanel({ state, handlers }: Props) {
  const {
    editorValue,
    hasSuggestion,
    pending,
    submitting,
    validation,
    mode,
    plan,
    jobDrafts,
    bundleValidation,
    metadataSummary,
    summaryText,
    workflowNotes,
    providerHasLogs,
    stdout,
    stderr,
    generation,
    providerLogTitle,
    activeProviderLabel,
    isEdited,
    canSubmit,
    canCreateJob,
    providerRequiresKey
  } = state;

  const {
    handleEditorChange,
    handleOpenInBuilder,
    handleSubmitWorkflow,
    handleSubmitJob,
    handleJobDraftChange,
    handleJobPromptChange,
    handleGenerateDependency,
    handleCreateDraftJob
  } = handlers;

  const renderJobDraft = (draft: JobDraft) => {
    const dependency = plan?.dependencies.find(
      (entry) => (entry.kind === 'job' || entry.kind === 'job-with-bundle') && entry.jobSlug === draft.slug
    );
    const isBundle = draft.mode === 'job-with-bundle';
    const hasResult = draft.value.trim().length > 0;
    const statusClass = draft.generating
      ? 'text-accent'
      : isBundle && draft.created
      ? STATUS_TEXT_SUCCESS
      : hasResult
      ? STATUS_TEXT_READY
      : STATUS_TEXT_PENDING;
    const statusText = draft.generating
      ? 'Generating…'
      : isBundle && draft.created
      ? 'Bundle published'
      : hasResult
      ? 'Draft ready'
      : 'Pending';
    const canGenerate =
      !draft.generating &&
      !pending &&
      !submitting &&
      draft.promptDraft.trim().length > 0 &&
      !providerRequiresKey;
    const canCreate =
      isBundle &&
      !!draft.bundle &&
      draft.bundleErrors.length === 0 &&
      draft.validation.valid &&
      !draft.generating &&
      !draft.creating &&
      !draft.created &&
      !pending &&
      !submitting &&
      canCreateJob;

    return (
      <div key={draft.id} className={SECTION_CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-scale-sm font-weight-semibold text-primary">
              {dependency && 'name' in dependency && dependency.name
                ? `${dependency.name} (${draft.slug})`
                : draft.slug}
            </h5>
            {dependency && 'summary' in dependency && dependency.summary && (
              <p className="text-[11px] text-secondary">{dependency.summary}</p>
            )}
            {dependency && 'dependsOn' in dependency && dependency.dependsOn && dependency.dependsOn.length > 0 && (
              <p className="text-[11px] text-secondary">
                Depends on: {dependency.dependsOn.join(', ')}
              </p>
            )}
          </div>
          <span className={`text-scale-xs font-weight-semibold ${statusClass}`}>{statusText}</span>
        </div>

        <label className={SECTION_LABEL}>
          Prompt
        </label>
        <textarea
          className={`${TEXTAREA_BASE} h-32`}
          value={draft.promptDraft}
          onChange={(event) => handleJobPromptChange(draft.id, event.target.value)}
          disabled={pending || submitting || draft.generating}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
          <button
            type="button"
            className={PRIMARY_ACTION_SMALL}
            onClick={() => void handleGenerateDependency(draft.id)}
            disabled={!canGenerate}
          >
            {draft.generating ? 'Generating…' : 'Generate job'}
          </button>
          {draft.bundle && (
            <span className="text-[11px] text-secondary">
              Suggested bundle{' '}
              <code className={CODE_CHIP}>
                {draft.bundle.slug}@{draft.bundle.version}
              </code>
            </span>
          )}
        </div>

        {draft.generationError && (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] font-weight-semibold ${getStatusToneClasses('danger')}`}>
            {draft.generationError}
          </div>
        )}

        {hasResult && (
          <>
            <label className={SECTION_LABEL}>
              Job definition
            </label>
            <textarea
              className={`${TEXTAREA_BASE} h-40 font-mono`}
              value={draft.value}
              onChange={(event) => handleJobDraftChange(draft.id, event.target.value)}
              spellCheck={false}
              disabled={draft.creating || draft.created || pending || submitting}
            />
          </>
        )}

        {draft.validation.errors.length > 0 && (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] font-weight-semibold ${getStatusToneClasses('warning')}`}>
            <p className="mb-1">Validation issues:</p>
            <ul className="list-disc pl-5">
              {draft.validation.errors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {isBundle && draft.bundle && (
          <div className="mt-2 rounded-lg border border-subtle bg-surface-glass p-3 text-[11px] text-secondary">
            Bundle{' '}
            <code className={CODE_CHIP}>
              {draft.bundle.slug}@{draft.bundle.version}
            </code>
            , entry{' '}
            <code className={CODE_CHIP}>
              {draft.bundle.entryPoint}
            </code>{' '}
            · {draft.bundle.files.length} file{draft.bundle.files.length === 1 ? '' : 's'}
          </div>
        )}

        {draft.bundleErrors.length > 0 && (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] font-weight-semibold ${getStatusToneClasses('warning')}`}>
            <p className="mb-1">Bundle issues:</p>
            <ul className="list-disc pl-5">
              {draft.bundleErrors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {draft.creationError && (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] font-weight-semibold ${getStatusToneClasses('danger')}`}>
            {draft.creationError}
          </div>
        )}

        {isBundle && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className={PRIMARY_ACTION_MEDIUM}
              onClick={() => void handleCreateDraftJob(draft.id)}
              disabled={!canCreate}
            >
              {draft.creating ? 'Creating…' : draft.created ? 'Job created' : 'Create job'}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={PANEL_SECTION}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-scale-sm font-weight-semibold uppercase tracking-[0.3em] text-muted">
          Suggestion Preview
        </h3>
        {hasSuggestion && (
          <span
            className={`text-scale-xs font-weight-semibold ${
              validation.valid ? 'text-status-success' : 'text-status-warning'
            }`}
          >
            {validation.valid ? 'Schema valid' : 'Needs fixes'}
          </span>
        )}
      </div>

      <textarea
        className={`${TEXTAREA_BASE} min-h-[320px] flex-1 font-mono`}
        value={editorValue}
        onChange={(event) => handleEditorChange(event.target.value)}
        spellCheck={false}
        disabled={!hasSuggestion || pending || submitting}
        placeholder="Generate a suggestion to edit the JSON payload."
      />

      {validation.errors.length > 0 && (
        <div className={`rounded-2xl border px-4 py-3 text-scale-xs font-weight-semibold ${getStatusToneClasses('warning')}`}>
          <p className="mb-1">Validation issues:</p>
          <ul className="list-disc pl-5">
            {validation.errors.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'workflow-with-jobs' && plan && (
        <div className={DIVIDER_CARD}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-scale-sm font-weight-semibold text-primary">Dependency plan</h4>
            <span className="text-scale-xs font-weight-semibold text-secondary">
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle' && draft.created).length}/
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle').length} bundles published
            </span>
          </div>
          {plan.notes && (
            <p className="mt-2 rounded-2xl border border-subtle bg-surface-glass p-3 text-[11px] leading-relaxed text-secondary">
              {plan.notes}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {plan.dependencies.map((dependency) => {
              const draft = jobDrafts.find((item) => item.slug === dependency.jobSlug);
              const isBundle = dependency.kind === 'job-with-bundle';
              const badge =
                dependency.kind === 'existing-job'
                  ? { text: 'Existing job', className: STATUS_TEXT_SUCCESS }
                  : draft?.mode === 'job-with-bundle' && draft.created
                  ? { text: 'Bundle published', className: STATUS_TEXT_SUCCESS }
                  : draft?.value.trim()
                  ? { text: 'Draft ready', className: STATUS_TEXT_READY }
                  : { text: 'Pending', className: STATUS_TEXT_PENDING };
              const displayName =
                'name' in dependency && dependency.name
                  ? `${dependency.jobSlug} · ${dependency.name}`
                  : dependency.jobSlug;
              return (
                <div
                  key={`${dependency.kind}-${dependency.jobSlug}`}
                  className="rounded-2xl border border-subtle bg-surface-glass p-3 shadow-elevation-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-scale-sm font-weight-semibold text-primary">{displayName}</p>
                      {'summary' in dependency && dependency.summary && (
                        <p className="text-[11px] text-secondary">{dependency.summary}</p>
                      )}
                    </div>
                    <span className={`text-scale-xs font-weight-semibold ${badge.className}`}>{badge.text}</span>
                  </div>
                  {'rationale' in dependency && dependency.rationale && (
                    <p className="mt-2 text-[11px] leading-relaxed text-secondary">{dependency.rationale}</p>
                  )}
                  {'dependsOn' in dependency && dependency.dependsOn && dependency.dependsOn.length > 0 && (
                    <p className="mt-2 text-[11px] text-secondary">
                      Depends on: {dependency.dependsOn.join(', ')}
                    </p>
                  )}
                  {isBundle && 'bundleOutline' in dependency && dependency.bundleOutline && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-secondary">
                        Target entry point{' '}
                        <code className={CODE_CHIP}>
                          {dependency.bundleOutline.entryPoint}
                        </code>
                        {dependency.bundleOutline.files && dependency.bundleOutline.files.length > 0 && (
                          <>
                            {' '}
                            · Expected files{' '}
                            {dependency.bundleOutline.files.map((file) => file.path).join(', ')}
                          </>
                        )}
                      </p>
                      {dependency.bundleOutline.capabilities && dependency.bundleOutline.capabilities.length > 0 && (
                        <p className="text-[11px] text-secondary">
                          Required capabilities: {dependency.bundleOutline.capabilities.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'workflow-with-jobs' && jobDrafts.length > 0 && (
        <div className={DIVIDER_CARD}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-scale-sm font-weight-semibold text-primary">Generate required jobs</h4>
            <span className="text-scale-xs font-weight-semibold text-secondary">
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle' && draft.created).length}/
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle').length} bundles published
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-secondary">
            Iterate on each prompt, generate the job specification, and publish bundle-backed jobs before submitting the workflow.
          </p>
          {!canCreateJob && (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-[11px] font-weight-semibold ${getStatusToneClasses('danger')}`}>
              Add a token with <code>job-bundles:write</code> scope to publish AI-generated jobs automatically.
            </div>
          )}
          <div className="mt-3 space-y-3">{jobDrafts.map(renderJobDraft)}</div>
        </div>
      )}

      {mode === 'job-with-bundle' && hasSuggestion && bundleValidation.errors.length > 0 && (
        <div className={`rounded-2xl border px-4 py-3 text-scale-xs font-weight-semibold ${getStatusToneClasses('warning')}`}>
          <p className="mb-1">Bundle issues:</p>
          <ul className="list-disc pl-5">
            {bundleValidation.errors.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'job-with-bundle' && hasSuggestion && !canCreateJob && (
        <div className={`rounded-2xl border px-4 py-3 text-scale-xs font-weight-semibold ${getStatusToneClasses('danger')}`}>
          Add a token with <code>job-bundles:write</code> scope to publish AI-generated bundles automatically.
        </div>
      )}

      {metadataSummary && (
        <details className={DIVIDER_CARD}>
          <summary className="cursor-pointer font-weight-semibold text-primary">
            Core snapshot shared with {activeProviderLabel}
          </summary>
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-secondary">
            {formatSummary(metadataSummary)}
          </pre>
        </details>
      )}

      {summaryText && (
        <details className={DIVIDER_CARD}>
          <summary className="cursor-pointer font-weight-semibold text-primary">
            {activeProviderLabel} summary notes
          </summary>
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-secondary">
            {summaryText}
          </pre>
        </details>
      )}

      {workflowNotes && (
        <div className={DIVIDER_CARD}>
          <h4 className="text-scale-sm font-weight-semibold text-primary">Operator follow-up notes</h4>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-secondary">
            {workflowNotes}
          </p>
        </div>
      )}

      {providerHasLogs && (stdout || stderr) && (
        <div className={DIVIDER_CARD}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-scale-sm font-weight-semibold text-primary">{providerLogTitle}</h4>
            {generation?.status === 'running' && (
              <span className="text-scale-xs font-weight-semibold text-accent">
                <span className="running-indicator">Running…</span>
              </span>
            )}
            {generation?.status === 'succeeded' && (
              <span className="text-scale-xs font-weight-semibold text-status-success">Completed</span>
            )}
            {generation?.status === 'failed' && (
              <span className="text-scale-xs font-weight-semibold text-status-danger">Failed</span>
            )}
          </div>
          {stdout && (
            <div className="mt-2">
              <h5 className="text-[11px] font-weight-semibold uppercase tracking-[0.3em] text-muted">
                stdout
              </h5>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-secondary">
                {stdout}
              </pre>
            </div>
          )}
          {stderr && (
            <div className="mt-2">
              <h5 className="text-[11px] font-weight-semibold uppercase tracking-[0.3em] text-muted">
                stderr
              </h5>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-status-danger">
                {stderr}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-scale-xs text-secondary">
          {hasSuggestion
            ? isEdited
              ? 'You have modified the generated spec.'
              : `Spec matches the ${activeProviderLabel} suggestion.`
            : 'Generate a suggestion to continue.'}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {mode === 'workflow' && (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={handleOpenInBuilder}
              disabled={!hasSuggestion || pending || submitting}
            >
              Review in manual builder
            </button>
          )}
          <button
            type="button"
            className={PRIMARY_SUBMIT_BUTTON}
            onClick={mode === 'workflow' || mode === 'workflow-with-jobs' ? handleSubmitWorkflow : handleSubmitJob}
            disabled={!canSubmit || pending || submitting}
          >
            {submitting
              ? 'Submitting…'
              : mode === 'workflow' || mode === 'workflow-with-jobs'
              ? 'Submit workflow'
              : mode === 'job-with-bundle'
              ? 'Submit job + bundle'
              : 'Submit job'}
          </button>
        </div>
      </div>
    </section>
  );
}
