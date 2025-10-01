import { useEffect, useMemo, useState, type JSX } from 'react';
import FormField from '../components/form/FormField';
import FormButton from '../components/form/FormButton';
import FormActions from '../components/form/FormActions';
import { Modal } from '../components';
import type { WorkflowScheduleSummary, ScheduleCreateInput, ScheduleUpdateInput } from './api';
import {
  SCHEDULE_ALERT_DANGER,
  SCHEDULE_CHECKBOX,
  SCHEDULE_DIALOG_SURFACE,
  SCHEDULE_FORM_HELPER,
  SCHEDULE_FORM_LABEL,
  SCHEDULE_FORM_SECTION,
  SCHEDULE_INPUT,
  SCHEDULE_SECONDARY_BUTTON_SMALL,
  SCHEDULE_SUBTITLE,
  SCHEDULE_TEXTAREA,
  SCHEDULE_TITLE
} from './scheduleTokens';

type WorkflowOption = {
  id: string;
  slug: string;
  name: string;
  defaultParameters?: unknown;
};

type ScheduleFormDialogProps = {
  mode: 'create' | 'edit';
  open: boolean;
  workflows: WorkflowOption[];
  schedule?: WorkflowScheduleSummary;
  submitting?: boolean;
  onClose: () => void;
  onCreate: (input: ScheduleCreateInput) => Promise<void> | void;
  onUpdate: (input: ScheduleUpdateInput) => Promise<void> | void;
};


function buildParametersText(parameters: unknown): string {
  if (!parameters || typeof parameters !== 'object') {
    return '{\n}\n';
  }
  try {
    return `${JSON.stringify(parameters, null, 2)}\n`;
  } catch {
    return '{\n}\n';
  }
}

function normalizeIsoInput(value: string | null): string {
  if (!value) {
    return '';
  }
  return value;
}

export default function ScheduleFormDialog({
  mode,
  open,
  workflows,
  schedule,
  submitting = false,
  onClose,
  onCreate,
  onUpdate
}: ScheduleFormDialogProps): JSX.Element | null {
  const [workflowSlug, setWorkflowSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cron, setCron] = useState('');
  const [timezone, setTimezone] = useState('');
  const [startWindow, setStartWindow] = useState('');
  const [endWindow, setEndWindow] = useState('');
  const [catchUp, setCatchUp] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [parametersText, setParametersText] = useState('{\n}\n');
  const [parametersDirty, setParametersDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFormError(null);
    if (mode === 'create') {
      const initialWorkflow = workflows.length > 0 ? workflows[0] : undefined;
      setWorkflowSlug(initialWorkflow?.slug ?? '');
      setName('');
      setDescription('');
      setCron('');
      setTimezone('');
      setStartWindow('');
      setEndWindow('');
      setCatchUp(true);
      setIsActive(true);
      setParametersText(buildParametersText(initialWorkflow?.defaultParameters ?? null));
      setParametersDirty(false);
    } else if (schedule) {
      const current = schedule.schedule;
      setWorkflowSlug(schedule.workflow.slug);
      setName(current.name ?? '');
      setDescription(current.description ?? '');
      setCron(current.cron);
      setTimezone(current.timezone ?? '');
      setStartWindow(normalizeIsoInput(current.startWindow));
      setEndWindow(normalizeIsoInput(current.endWindow));
      setCatchUp(Boolean(current.catchUp));
      setIsActive(Boolean(current.isActive));
      setParametersText(buildParametersText(current.parameters));
      setParametersDirty(false);
    }
  }, [mode, open, schedule, workflows]);

  const workflowOptions = useMemo(() => {
    return workflows.map((option) => ({ value: option.slug, label: option.name }));
  }, [workflows]);

  const selectedWorkflow = useMemo(() => {
    return workflows.find((option) => option.slug === workflowSlug) ?? null;
  }, [workflowSlug, workflows]);

  useEffect(() => {
    if (!open || mode !== 'create' || !selectedWorkflow || parametersDirty) {
      return;
    }

    const defaultText = buildParametersText(selectedWorkflow.defaultParameters ?? null);
    if (parametersText !== defaultText) {
      setParametersText(defaultText);
      setParametersDirty(false);
    }
  }, [mode, open, parametersDirty, parametersText, selectedWorkflow]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    setFormError(null);
    if (!cron.trim()) {
      setFormError('Cron expression is required.');
      return;
    }

    let parameters: Record<string, unknown> | null = null;
    const trimmedParameters = parametersText.trim();
    if (trimmedParameters.length > 0 && trimmedParameters !== '{\n}\n' && trimmedParameters !== '{}') {
      try {
        const parsed = JSON.parse(trimmedParameters) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setFormError('Parameters must be a JSON object.');
          return;
        }
        parameters = parsed as Record<string, unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid JSON';
        setFormError(`Invalid parameters JSON: ${message}`);
        return;
      }
    }

    if (mode === 'create') {
      if (!workflowSlug) {
        setFormError('Select a workflow to schedule.');
        return;
      }
      const input: ScheduleCreateInput = {
        workflowSlug,
        name: name.trim().length > 0 ? name.trim() : null,
        description: description.trim().length > 0 ? description.trim() : null,
        cron: cron.trim(),
        timezone: timezone.trim().length > 0 ? timezone.trim() : null,
        parameters,
        startWindow: startWindow.trim().length > 0 ? startWindow.trim() : null,
        endWindow: endWindow.trim().length > 0 ? endWindow.trim() : null,
        catchUp,
        isActive
      };
      await onCreate(input);
    } else if (schedule) {
      const update: ScheduleUpdateInput = {
        scheduleId: schedule.schedule.id,
        name: name.trim().length > 0 ? name.trim() : null,
        description: description.trim().length > 0 ? description.trim() : null,
        cron: cron.trim(),
        timezone: timezone.trim().length > 0 ? timezone.trim() : null,
        parameters,
        startWindow: startWindow.trim().length > 0 ? startWindow.trim() : null,
        endWindow: endWindow.trim().length > 0 ? endWindow.trim() : null,
        catchUp,
        isActive
      };
      await onUpdate(update);
    }
  };

  const dialogTitle = mode === 'create' ? 'Create Schedule' : 'Edit Schedule';
  const workflowLabel = mode === 'create' ? 'Workflow' : 'Workflow (read-only)';
  const dialogTitleId = 'schedule-form-title';

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={dialogTitleId}
      closeOnBackdrop={false}
      className="items-start justify-center px-4 py-6 sm:items-center"
      contentClassName={SCHEDULE_DIALOG_SURFACE}
    >
      <>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={dialogTitleId} className={SCHEDULE_TITLE}>
              {dialogTitle}
            </h2>
            <p className={SCHEDULE_SUBTITLE}>Configure the schedule cadence and parameters.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={SCHEDULE_SECONDARY_BUTTON_SMALL}
            disabled={submitting}
          >
            Close
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <FormField label={<span className={SCHEDULE_FORM_LABEL}>{workflowLabel}</span>}>
            {mode === 'create' ? (
              <select
                className={SCHEDULE_INPUT}
                value={workflowSlug}
                onChange={(event) => {
                  const nextSlug = event.target.value;
                  if (nextSlug !== workflowSlug) {
                    setParametersDirty(false);
                  }
                  setWorkflowSlug(nextSlug);
                }}
                disabled={submitting || workflowOptions.length === 0}
              >
                {workflowOptions.length === 0 ? (
                  <option value="">No workflows available</option>
                ) : null}
                {workflowOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className={SCHEDULE_FORM_SECTION}>
                {schedule?.workflow.name ?? 'Unknown workflow'}
              </div>
            )}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={<span className={SCHEDULE_FORM_LABEL}>Display name (optional)</span>}>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitting}
                placeholder="Morning refresh"
                className={SCHEDULE_INPUT}
              />
            </FormField>
            <FormField label={<span className={SCHEDULE_FORM_LABEL}>Description (optional)</span>}>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
                placeholder="Daily summary at 9am"
                className={SCHEDULE_INPUT}
              />
            </FormField>
          </div>

          <FormField
            label={<span className={SCHEDULE_FORM_LABEL}>Cron expression</span>}
            hint={<span className={SCHEDULE_FORM_HELPER}>Use five-field cron syntax. Example: 0 9 * * *</span>}
          >
            <input
              type="text"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              disabled={submitting}
              placeholder="0 9 * * *"
              className={SCHEDULE_INPUT}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={<span className={SCHEDULE_FORM_LABEL}>Timezone (optional)</span>}
              hint={<span className={SCHEDULE_FORM_HELPER}>IANA timezone identifier, e.g. UTC or America/New_York</span>}
            >
              <input
                type="text"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={submitting}
                placeholder="UTC"
                className={SCHEDULE_INPUT}
              />
            </FormField>
            <FormField label={<span className={SCHEDULE_FORM_LABEL}>Catch up missed runs</span>}>
              <label className="flex items-center gap-2 text-scale-sm text-secondary">
                <input
                  type="checkbox"
                  checked={catchUp}
                  onChange={(event) => setCatchUp(event.target.checked)}
                  disabled={submitting}
                  className={SCHEDULE_CHECKBOX}
                />
                Allow scheduler to backfill missed windows
              </label>
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={<span className={SCHEDULE_FORM_LABEL}>Start window (optional)</span>}
              hint={<span className={SCHEDULE_FORM_HELPER}>ISO timestamp restricting earliest execution window</span>}
            >
              <input
                type="text"
                value={startWindow}
                onChange={(event) => setStartWindow(event.target.value)}
                disabled={submitting}
                placeholder="2024-05-01T09:00:00Z"
                className={SCHEDULE_INPUT}
              />
            </FormField>
            <FormField
              label={<span className={SCHEDULE_FORM_LABEL}>End window (optional)</span>}
              hint={<span className={SCHEDULE_FORM_HELPER}>ISO timestamp to stop scheduling</span>}
            >
              <input
                type="text"
                value={endWindow}
                onChange={(event) => setEndWindow(event.target.value)}
                disabled={submitting}
                placeholder="2024-06-01T09:00:00Z"
                className={SCHEDULE_INPUT}
              />
            </FormField>
          </div>

          <FormField label={<span className={SCHEDULE_FORM_LABEL}>Parameters (JSON object)</span>}>
            <textarea
              value={parametersText}
              onChange={(event) => {
                setParametersText(event.target.value);
                setParametersDirty(true);
              }}
              disabled={submitting}
              rows={6}
              className={SCHEDULE_TEXTAREA}
            />
          </FormField>

          <FormField>
            <label className="flex items-center gap-2 text-scale-sm text-secondary">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={submitting}
                className={SCHEDULE_CHECKBOX}
              />
              Schedule is active
            </label>
          </FormField>

          {formError ? (
            <div className={SCHEDULE_ALERT_DANGER}>
              {formError}
            </div>
          ) : null}

          <FormActions className="justify-end">
            <FormButton variant="secondary" size="sm" type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </FormButton>
            <FormButton size="sm" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
              {mode === 'create' ? 'Create schedule' : 'Save changes'}
            </FormButton>
          </FormActions>
        </div>
      </>
    </Modal>
  );
}
