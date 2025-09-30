import { Spinner } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
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

const PANEL_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-5 shadow-elevation-lg backdrop-blur-md transition-colors';

const PANEL_TITLE = 'text-scale-sm font-weight-semibold text-primary';

const MESSAGE_CARD_BASE =
  'rounded-2xl border px-4 py-3 text-scale-sm font-weight-medium shadow-elevation-sm transition-colors';

const MESSAGE_CARD_NEUTRAL = `${MESSAGE_CARD_BASE} border-subtle bg-surface-muted text-secondary`;

const MESSAGE_CARD_ERROR = `${MESSAGE_CARD_BASE} ${getStatusToneClasses('danger')}`;

const MESSAGE_CARD_WARNING = `${MESSAGE_CARD_BASE} ${getStatusToneClasses('warning')}`;

const LIST_CONTAINER = 'flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1';

const SUMMARY_ITEM_BASE =
  'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SUMMARY_ITEM_ACTIVE = 'border-accent bg-accent-soft text-accent-strong shadow-elevation-sm';

const SUMMARY_ITEM_INACTIVE =
  'border-subtle bg-surface-glass text-primary hover:border-accent-soft hover:bg-surface-glass-soft';

const SUMMARY_SLUG_TEXT = 'text-scale-xs text-secondary';

const SUMMARY_META_TEXT = 'text-[11px] text-muted';

const SUMMARY_TAG_TEXT = 'text-[10px] uppercase tracking-[0.4em] text-muted';

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
    <section className={PANEL_CONTAINER}>
      <h2 className={PANEL_TITLE}>Workflow Definitions</h2>
      <div className="mt-4 flex flex-col gap-2">
        {workflowsLoading && (
          <div className={MESSAGE_CARD_NEUTRAL}>
            <Spinner label="Loading workflows…" size="sm" />
          </div>
        )}
        {workflowsError && !workflowsLoading && (
          <div className={MESSAGE_CARD_ERROR}>
            {workflowsError}
          </div>
        )}
        {!workflowsLoading && !workflowsError && filteredWorkflowCount === 0 && totalWorkflowCount > 0 && (
          <div className={MESSAGE_CARD_WARNING}>
            No workflows match your filters yet.
          </div>
        )}
        {!workflowsLoading && !workflowsError && totalWorkflowCount === 0 && (
          <div className={MESSAGE_CARD_NEUTRAL}>
            No workflows registered yet.
          </div>
        )}

        <div className={LIST_CONTAINER}>
          {summaries.map((summary) => {
            const workflow = summary.workflow;
            const isActive = workflow.slug === selectedSlug;
            return (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onSelect(workflow.slug)}
                className={`${SUMMARY_ITEM_BASE} ${isActive ? SUMMARY_ITEM_ACTIVE : SUMMARY_ITEM_INACTIVE}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-scale-sm font-weight-semibold text-primary">{workflow.name}</span>
                  <StatusBadge status={summary.status} />
                </div>
                <span className={SUMMARY_SLUG_TEXT}>{workflow.slug}</span>
                {summary.repos.length > 0 && (
                  <span className={SUMMARY_META_TEXT}>{summary.repos.join(', ')}</span>
                )}
                {summary.tags.length > 0 && (
                  <span className={SUMMARY_TAG_TEXT}>
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
