import type { WorkflowDefinition } from '../types';
import { Spinner } from '../../components';

type WorkflowDetailsCardProps = {
  workflow: WorkflowDefinition | null;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  onEdit: () => void;
};

const CARD_CONTAINER_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const CARD_HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const CARD_MESSAGE_TEXT_CLASSES = 'mt-3 text-scale-sm text-secondary';

const CARD_ERROR_TEXT_CLASSES = 'mt-3 text-scale-sm font-weight-semibold text-status-danger';

const CARD_DESCRIPTION_TEXT_CLASSES = 'text-scale-sm text-secondary';

const CARD_META_TEXT_CLASSES = 'mt-1 text-scale-xs text-muted';

const EDIT_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent-soft px-3 py-1 text-scale-xs font-weight-semibold text-accent transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const STEPS_SECTION_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const STEP_ITEM_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-sm text-secondary';

const STEP_META_TEXT_CLASSES = 'text-scale-xs text-muted';

export default function WorkflowDetailsCard({
  workflow,
  loading,
  error,
  canEdit,
  onEdit
}: WorkflowDetailsCardProps) {
  return (
    <section className={CARD_CONTAINER_CLASSES}>
      <div className="flex items-start justify-between gap-4">
        <h2 className={CARD_HEADER_TITLE_CLASSES}>Workflow Details</h2>
        {workflow && (
          <button
            type="button"
            className={EDIT_BUTTON_CLASSES}
            onClick={onEdit}
            disabled={!canEdit}
            title={canEdit ? undefined : 'Insufficient scope: workflows:write required to edit workflows.'}
          >
            Edit workflow
          </button>
        )}
      </div>
      {loading && (
        <p className={CARD_MESSAGE_TEXT_CLASSES}>
          <Spinner label="Loading workflow details…" size="xs" />
        </p>
      )}
      {error && !loading && (
        <p className={CARD_ERROR_TEXT_CLASSES}>{error}</p>
      )}
      {!loading && !error && workflow && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            {workflow.description && (
              <p className={CARD_DESCRIPTION_TEXT_CLASSES}>{workflow.description}</p>
            )}
            <p className={CARD_META_TEXT_CLASSES}>
              {workflow.triggers.length > 0
                ? `Triggers: ${workflow.triggers.map((trigger) => trigger.type).join(', ')}`
                : 'Triggers: manual'}
            </p>
          </div>
          <div>
            <h3 className={STEPS_SECTION_TITLE_CLASSES}>Steps</h3>
            <ol className="mt-2 flex flex-col gap-2">
              {workflow.steps.map((step, index) => (
                <li
                  key={step.id}
                  className={STEP_ITEM_CLASSES}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {index + 1}. {step.name}
                    </span>
                    <span className={STEP_META_TEXT_CLASSES}>
                      {step.serviceSlug ?? step.jobSlug ?? 'step'}
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
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
