import StatusBadge from './StatusBadge';
import type { WorkflowSummary } from '../normalizers';

type WorkflowDefinitionsPanelProps = {
  workflowsLoading: boolean;
  workflowsError: string | null;
  summaries: WorkflowSummary[];
  totalWorkflowCount: number;
  filteredWorkflowCount: number;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
};

export default function WorkflowDefinitionsPanel({
  workflowsLoading,
  workflowsError,
  summaries,
  totalWorkflowCount,
  filteredWorkflowCount,
  selectedSlug,
  onSelect
}: WorkflowDefinitionsPanelProps) {
  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Workflow Definitions</h2>
      <div className="mt-4 flex flex-col gap-2">
        {workflowsLoading && (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            Loading workflows…
          </div>
        )}
        {workflowsError && !workflowsLoading && (
          <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {workflowsError}
          </div>
        )}
        {!workflowsLoading && !workflowsError && filteredWorkflowCount === 0 && totalWorkflowCount > 0 && (
          <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-sm font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            No workflows match your filters yet.
          </div>
        )}
        {!workflowsLoading && !workflowsError && totalWorkflowCount === 0 && (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            No workflows registered yet.
          </div>
        )}

        <div className="flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1">
          {summaries.map((summary) => {
            const workflow = summary.workflow;
            const isActive = workflow.slug === selectedSlug;
            return (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onSelect(workflow.slug)}
                className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                  isActive
                    ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:border-slate-300 dark:bg-slate-800/70 dark:text-slate-100'
                    : 'border-slate-200/60 bg-white/70 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{workflow.name}</span>
                  <StatusBadge status={summary.status} />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">{workflow.slug}</span>
                {summary.repos.length > 0 && (
                  <span className="text-[11px] text-slate-400">{summary.repos.join(', ')}</span>
                )}
                {summary.tags.length > 0 && (
                  <span className="text-[10px] uppercase tracking-widest text-slate-400">
                    {summary.tags.join(' · ')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
