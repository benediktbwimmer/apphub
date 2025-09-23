import type { AiBuilderDialogHandlers, AiBuilderDialogState, JobDraft } from '../types';
import { formatSummary } from '../utils';

const dividerClass = 'rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200';

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
      ? 'text-violet-600 dark:text-violet-300'
      : isBundle && draft.created
      ? 'text-emerald-600 dark:text-emerald-300'
      : hasResult
      ? 'text-slate-600 dark:text-slate-300'
      : 'text-slate-500 dark:text-slate-400';
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
      <div
        key={draft.id}
        className="rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/80"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-100">
              {dependency && 'name' in dependency && dependency.name
                ? `${dependency.name} (${draft.slug})`
                : draft.slug}
            </h5>
            {dependency && 'summary' in dependency && dependency.summary && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{dependency.summary}</p>
            )}
            {dependency && 'dependsOn' in dependency && dependency.dependsOn && dependency.dependsOn.length > 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Depends on: {dependency.dependsOn.join(', ')}
              </p>
            )}
          </div>
          <span className={`text-xs font-semibold ${statusClass}`}>{statusText}</span>
        </div>

        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Prompt
        </label>
        <textarea
          className="mt-1 h-32 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 text-[11px] leading-relaxed text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
          value={draft.promptDraft}
          onChange={(event) => handleJobPromptChange(draft.id, event.target.value)}
          disabled={pending || submitting || draft.generating}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <button
            type="button"
            className="rounded-full border border-violet-500/80 bg-violet-600 px-3 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleGenerateDependency(draft.id)}
            disabled={!canGenerate}
          >
            {draft.generating ? 'Generating…' : 'Generate job'}
          </button>
          {draft.bundle && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Suggested bundle{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {draft.bundle.slug}@{draft.bundle.version}
              </code>
            </span>
          )}
        </div>

        {draft.generationError && (
          <div className="mt-2 rounded-lg border border-rose-300/70 bg-rose-50/70 p-3 text-[11px] font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {draft.generationError}
          </div>
        )}

        {hasResult && (
          <>
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Job definition
            </label>
            <textarea
              className="mt-1 h-40 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
              value={draft.value}
              onChange={(event) => handleJobDraftChange(draft.id, event.target.value)}
              spellCheck={false}
              disabled={draft.creating || draft.created || pending || submitting}
            />
          </>
        )}

        {draft.validation.errors.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="mb-1">Validation issues:</p>
            <ul className="list-disc pl-5">
              {draft.validation.errors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {isBundle && draft.bundle && (
          <div className="mt-2 rounded-lg border border-slate-200/70 bg-slate-50/80 p-3 text-[11px] text-slate-600 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-300">
            Bundle{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {draft.bundle.slug}@{draft.bundle.version}
            </code>
            , entry{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {draft.bundle.entryPoint}
            </code>{' '}
            · {draft.bundle.files.length} file{draft.bundle.files.length === 1 ? '' : 's'}
          </div>
        )}

        {draft.bundleErrors.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="mb-1">Bundle issues:</p>
            <ul className="list-disc pl-5">
              {draft.bundleErrors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {draft.creationError && (
          <div className="mt-2 rounded-lg border border-rose-300/70 bg-rose-50/70 p-3 text-[11px] font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {draft.creationError}
          </div>
        )}

        {isBundle && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
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
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Suggestion Preview
        </h3>
        {hasSuggestion && (
          <span
            className={`text-xs font-semibold ${
              validation.valid ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'
            }`}
          >
            {validation.valid ? 'Schema valid' : 'Needs fixes'}
          </span>
        )}
      </div>

      <textarea
        className="min-h-[320px] flex-1 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 font-mono text-xs text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
        value={editorValue}
        onChange={(event) => handleEditorChange(event.target.value)}
        spellCheck={false}
        disabled={!hasSuggestion || pending || submitting}
        placeholder="Generate a suggestion to edit the JSON payload."
      />

      {validation.errors.length > 0 && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="mb-1">Validation issues:</p>
          <ul className="list-disc pl-5">
            {validation.errors.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'workflow-with-jobs' && plan && (
        <div className={dividerClass}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Dependency plan</h4>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle' && draft.created).length}/
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle').length} bundles published
            </span>
          </div>
          {plan.notes && (
            <p className="mt-2 rounded-xl border border-slate-200/60 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-300">
              {plan.notes}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {plan.dependencies.map((dependency) => {
              const draft = jobDrafts.find((item) => item.slug === dependency.jobSlug);
              const isBundle = dependency.kind === 'job-with-bundle';
              const badge =
                dependency.kind === 'existing-job'
                  ? { text: 'Existing job', className: 'text-emerald-600 dark:text-emerald-300' }
                  : draft?.mode === 'job-with-bundle' && draft.created
                  ? { text: 'Bundle published', className: 'text-emerald-600 dark:text-emerald-300' }
                  : draft?.value.trim()
                  ? { text: 'Draft ready', className: 'text-violet-600 dark:text-violet-300' }
                  : { text: 'Pending', className: 'text-slate-500 dark:text-slate-400' };
              const displayName =
                'name' in dependency && dependency.name
                  ? `${dependency.jobSlug} · ${dependency.name}`
                  : dependency.jobSlug;
              return (
                <div
                  key={`${dependency.kind}-${dependency.jobSlug}`}
                  className="rounded-xl border border-slate-200/60 bg-white/80 p-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/80"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{displayName}</p>
                      {'summary' in dependency && dependency.summary && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{dependency.summary}</p>
                      )}
                    </div>
                    <span className={`text-xs font-semibold ${badge.className}`}>{badge.text}</span>
                  </div>
                  {'rationale' in dependency && dependency.rationale && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {dependency.rationale}
                    </p>
                  )}
                  {'dependsOn' in dependency && dependency.dependsOn && dependency.dependsOn.length > 0 && (
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      Depends on: {dependency.dependsOn.join(', ')}
                    </p>
                  )}
                  {isBundle && 'bundleOutline' in dependency && dependency.bundleOutline && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Target entry point{' '}
                        <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
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
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
        <div className={dividerClass}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Generate required jobs</h4>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle' && draft.created).length}/
              {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle').length} bundles published
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            Iterate on each prompt, generate the job specification, and publish bundle-backed jobs before submitting the workflow.
          </p>
          {!canCreateJob && (
            <div className="mt-3 rounded-xl border border-rose-300/70 bg-rose-50/70 p-3 text-[11px] font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              Add a token with <code>job-bundles:write</code> scope to publish AI-generated jobs automatically.
            </div>
          )}
          <div className="mt-3 space-y-3">{jobDrafts.map(renderJobDraft)}</div>
        </div>
      )}

      {mode === 'job-with-bundle' && hasSuggestion && bundleValidation.errors.length > 0 && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="mb-1">Bundle issues:</p>
          <ul className="list-disc pl-5">
            {bundleValidation.errors.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'job-with-bundle' && hasSuggestion && !canCreateJob && (
        <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          Add a token with <code>job-bundles:write</code> scope to publish AI-generated bundles automatically.
        </div>
      )}

      {metadataSummary && (
        <details className={dividerClass}>
          <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
            Catalog snapshot shared with {activeProviderLabel}
          </summary>
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            {formatSummary(metadataSummary)}
          </pre>
        </details>
      )}

      {summaryText && (
        <details className={dividerClass}>
          <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
            {activeProviderLabel} summary notes
          </summary>
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            {summaryText}
          </pre>
        </details>
      )}

      {workflowNotes && (
        <div className={dividerClass}>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Operator follow-up notes</h4>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            {workflowNotes}
          </p>
        </div>
      )}

      {providerHasLogs && (stdout || stderr) && (
        <div className={dividerClass}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">{providerLogTitle}</h4>
            {generation?.status === 'running' && (
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-300">
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-violet-500" /> Running…
              </span>
            )}
            {generation?.status === 'succeeded' && (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Completed</span>
            )}
            {generation?.status === 'failed' && (
              <span className="text-xs font-semibold text-rose-500 dark:text-rose-300">Failed</span>
            )}
          </div>
          {stdout && (
            <div className="mt-2">
              <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                stdout
              </h5>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-300">
                {stdout}
              </pre>
            </div>
          )}
          {stderr && (
            <div className="mt-2">
              <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                stderr
              </h5>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-rose-500 dark:text-rose-300">
                {stderr}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">
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
              className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200"
              onClick={handleOpenInBuilder}
              disabled={!hasSuggestion || pending || submitting}
            >
              Review in manual builder
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={mode === 'workflow' || mode === 'workflow-with-jobs' ? handleSubmitWorkflow : handleSubmitJob}
            disabled={!canSubmit}
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
