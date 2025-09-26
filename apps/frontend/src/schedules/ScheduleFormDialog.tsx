import { useEffect, useMemo, useState, type JSX } from 'react';
import FormField from '../components/form/FormField';
import FormButton from '../components/form/FormButton';
import FormActions from '../components/form/FormActions';
import { Modal } from '../components';
import type { WorkflowScheduleSummary, ScheduleCreateInput, ScheduleUpdateInput } from './api';

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
      contentClassName="relative w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-xl dark:border-slate-700/60 dark:bg-slate-900/80 max-h-[calc(100vh-3rem)] overflow-y-auto"
    >
      <>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={dialogTitleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {dialogTitle}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
            Configure the schedule cadence and parameters.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-300/70 px-3 py-1 text-sm text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-400"
          disabled={submitting}
        >
          Close
        </button>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <FormField label={workflowLabel}>
            {mode === 'create' ? (
              <select
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
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
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
                {schedule?.workflow.name ?? 'Unknown workflow'}
              </div>
            )}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Display name (optional)">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitting}
                placeholder="Morning refresh"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </FormField>
            <FormField label="Description (optional)">
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
                placeholder="Daily summary at 9am"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </FormField>
          </div>

          <FormField label="Cron expression" hint="Use five-field cron syntax. Example: 0 9 * * *">
            <input
              type="text"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              disabled={submitting}
              placeholder="0 9 * * *"
              className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Timezone (optional)" hint="IANA timezone identifier, e.g. UTC or America/New_York">
              <input
                type="text"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={submitting}
                placeholder="UTC"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </FormField>
            <FormField label="Catch up missed runs">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={catchUp}
                  onChange={(event) => setCatchUp(event.target.checked)}
                  disabled={submitting}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                Allow scheduler to backfill missed windows
              </label>
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Start window (optional)" hint="ISO timestamp restricting earliest execution window">
              <input
                type="text"
                value={startWindow}
                onChange={(event) => setStartWindow(event.target.value)}
                disabled={submitting}
                placeholder="2024-05-01T09:00:00Z"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </FormField>
            <FormField label="End window (optional)" hint="ISO timestamp to stop scheduling">
              <input
                type="text"
                value={endWindow}
                onChange={(event) => setEndWindow(event.target.value)}
                disabled={submitting}
                placeholder="2024-06-01T09:00:00Z"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </FormField>
          </div>

          <FormField label="Parameters (JSON object)">
            <textarea
              value={parametersText}
              onChange={(event) => {
                setParametersText(event.target.value);
                setParametersDirty(true);
              }}
              disabled={submitting}
              rows={6}
              className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2 font-mono text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100"
            />
          </FormField>

          <FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Schedule is active
            </label>
          </FormField>

          {formError ? (
            <div className="rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200">
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
