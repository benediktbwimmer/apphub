type WorkflowsHeaderProps = {
  canUseAiBuilder: boolean;
  onOpenAiBuilder: () => void;
  canEditWorkflows: boolean;
  onOpenCreateWorkflow: () => void;
  onRefresh: () => void;
};

export default function WorkflowsHeader({
  canUseAiBuilder,
  onOpenAiBuilder,
  canEditWorkflows,
  onOpenCreateWorkflow,
  onRefresh
}: WorkflowsHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Workflows</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Discover workflow definitions, launch runs with validated parameters, and monitor execution in realtime.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          onClick={onOpenAiBuilder}
          disabled={!canUseAiBuilder}
          title={
            canUseAiBuilder
              ? 'Draft jobs or workflows with Codex assistance.'
              : 'Add an operator token with workflows:write or jobs:write scope to use the AI builder.'
          }
        >
          AI builder
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-violet-500/60 bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500"
          onClick={onOpenCreateWorkflow}
          disabled={!canEditWorkflows}
          title={
            canEditWorkflows
              ? undefined
              : 'Add an operator token with workflows:write scope to create workflows.'
          }
        >
          Create workflow
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
