import type { WorkflowDefinition } from '../types';

type WorkflowDetailsCardProps = {
  workflow: WorkflowDefinition | null;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  onEdit: () => void;
};

export default function WorkflowDetailsCard({
  workflow,
  loading,
  error,
  canEdit,
  onEdit
}: WorkflowDetailsCardProps) {
  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow Details</h2>
        {workflow && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-violet-500/60 bg-violet-600/10 px-3 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-400/60 dark:text-violet-200"
            onClick={onEdit}
            disabled={!canEdit}
            title={canEdit ? undefined : 'Insufficient scope: workflows:write required to edit workflows.'}
          >
            Edit workflow
          </button>
        )}
      </div>
      {loading && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading workflow details…</p>
      )}
      {error && !loading && (
        <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">{error}</p>
      )}
      {!loading && !error && workflow && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            {workflow.description && (
              <p className="text-sm text-slate-600 dark:text-slate-300">{workflow.description}</p>
            )}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {workflow.triggers.length > 0
                ? `Triggers: ${workflow.triggers.map((trigger) => trigger.type).join(', ')}`
                : 'Triggers: manual'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Steps</h3>
            <ol className="mt-2 flex flex-col gap-2">
              {workflow.steps.map((step, index) => (
                <li
                  key={step.id}
                  className="rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/70 dark:text-slate-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {index + 1}. {step.name}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {step.serviceSlug ?? step.jobSlug ?? 'step'}
                    </span>
                  </div>
                  {step.description && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{step.description}</p>
                  )}
                  {step.dependsOn && step.dependsOn.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Depends on: {step.dependsOn.join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
