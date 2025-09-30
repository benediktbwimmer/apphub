type WorkflowsHeaderProps = {
  canUseAiBuilder: boolean;
  onOpenAiBuilder: () => void;
  canEditWorkflows: boolean;
  onOpenCreateWorkflow: () => void;
  onRefresh: () => void;
};

const TITLE_CLASSES = 'text-scale-2xl font-weight-semibold text-primary';

const SUBTITLE_CLASSES = 'text-scale-sm text-secondary';

const SECONDARY_ACTION_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_ACTION_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

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
        <h1 className={TITLE_CLASSES}>Workflows</h1>
        <p className={SUBTITLE_CLASSES}>
          Discover workflow definitions, launch runs with validated parameters, and monitor execution in realtime.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={SECONDARY_ACTION_CLASSES}
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
          className={PRIMARY_ACTION_CLASSES}
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
          className={SECONDARY_ACTION_CLASSES}
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
