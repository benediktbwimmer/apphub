import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Spinner } from '../components';
import FormButton from '../components/form/FormButton';
import { useToasts } from '../components/toast';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import {
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  updateSchedule,
  type ScheduleCreateInput,
  type ScheduleUpdateInput,
  type WorkflowScheduleSummary
} from './api';
import { fetchWorkflowDefinitions } from '../workflows/api';
import type { WorkflowDefinition, WorkflowSchedule } from '../workflows/types';
import { formatTimestamp } from '../workflows/formatters';
import ScheduleFormDialog from './ScheduleFormDialog';

const TABLE_HEADER_CLASSES =
  'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300';
const TABLE_CELL_CLASSES = 'px-4 py-2 text-sm text-slate-700 dark:text-slate-200 align-top';

function formatNextRun(schedule: WorkflowSchedule): string {
  if (!schedule.nextRunAt) {
    return schedule.isActive ? '—' : 'Paused';
  }
  return formatTimestamp(schedule.nextRunAt);
}

function formatParameters(parameters: unknown): string {
  if (parameters === null || parameters === undefined) {
    return '—';
  }
  try {
    const text = JSON.stringify(parameters, null, 2);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  } catch {
    return String(parameters);
  }
}

type FormState = {
  mode: 'create' | 'edit';
  open: boolean;
  schedule?: WorkflowScheduleSummary;
};

export default function SchedulesPage(): JSX.Element {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<WorkflowScheduleSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [formState, setFormState] = useState<FormState>({ mode: 'create', open: false });
  const [submitting, setSubmitting] = useState(false);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSchedules(authorizedFetch);
      setSchedules(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load schedules';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  const loadWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    try {
      const definitions = await fetchWorkflowDefinitions(authorizedFetch);
      setWorkflows(definitions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workflows';
      pushToast({
        tone: 'info',
        title: 'Failed to load workflows',
        description: message
      });
    } finally {
      setWorkflowsLoading(false);
    }
  }, [authorizedFetch, pushToast]);

  useEffect(() => {
    void loadSchedules();
    void loadWorkflows();
  }, [loadSchedules, loadWorkflows]);

  const workflowOptions = useMemo(() => {
    return workflows
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((workflow) => ({ id: workflow.id, slug: workflow.slug, name: workflow.name }));
  }, [workflows]);

  const handleRefresh = useCallback(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const handleOpenCreate = useCallback(() => {
    setFormState({ mode: 'create', open: true });
  }, []);

  const handleOpenEdit = useCallback((summary: WorkflowScheduleSummary) => {
    setFormState({ mode: 'edit', open: true, schedule: summary });
  }, []);

  const handleFormClose = useCallback(() => {
    if (submitting) {
      return;
    }
    setFormState((state) => ({ ...state, open: false }));
  }, [submitting]);

  const handleCreate = useCallback(
    async (input: Omit<ScheduleCreateInput, 'workflowSlug'> & { workflowSlug: string }) => {
      setSubmitting(true);
      try {
        const summary = await createSchedule(authorizedFetch, input);
        setSchedules((current) => {
          const next = current.filter((entry) => entry.schedule.id !== summary.schedule.id);
          next.push(summary);
          return next.sort((a, b) => a.workflow.name.localeCompare(b.workflow.name));
        });
        pushToast({
          tone: 'success',
          title: 'Schedule created',
          description: `${summary.workflow.name} (${summary.schedule.cron})`
        });
        setFormState({ mode: 'create', open: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create schedule';
        pushToast({ tone: 'error', title: 'Failed to create schedule', description: message });
      } finally {
        setSubmitting(false);
      }
    },
    [authorizedFetch, pushToast]
  );

  const handleUpdate = useCallback(
    async (input: ScheduleUpdateInput) => {
      setSubmitting(true);
      try {
        const summary = await updateSchedule(authorizedFetch, input);
        setSchedules((current) =>
          current
            .map((entry) => (entry.schedule.id === summary.schedule.id ? summary : entry))
            .sort((a, b) => a.workflow.name.localeCompare(b.workflow.name))
        );
        pushToast({
          tone: 'success',
          title: 'Schedule updated',
          description: `${summary.workflow.name} (${summary.schedule.cron})`
        });
        setFormState({ mode: 'edit', open: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update schedule';
        pushToast({ tone: 'error', title: 'Failed to update schedule', description: message });
      } finally {
        setSubmitting(false);
      }
    },
    [authorizedFetch, pushToast]
  );

  const handleDelete = useCallback(
    async (summary: WorkflowScheduleSummary) => {
      const confirmed = window.confirm(`Delete the schedule "${summary.schedule.name ?? summary.schedule.cron}"?`);
      if (!confirmed) {
        return;
      }
      try {
        await deleteSchedule(authorizedFetch, summary.schedule.id);
        setSchedules((current) => current.filter((entry) => entry.schedule.id !== summary.schedule.id));
        pushToast({
          tone: 'success',
          title: 'Schedule deleted',
          description: `${summary.workflow.name}`
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete schedule';
        pushToast({ tone: 'error', title: 'Failed to delete schedule', description: message });
      }
    },
    [authorizedFetch, pushToast]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Schedules</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Review and manage automated workflow schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FormButton variant="secondary" size="sm" onClick={handleRefresh} disabled={loading}>
            Refresh
          </FormButton>
          <FormButton size="sm" onClick={handleOpenCreate} disabled={workflowsLoading}>
            New Schedule
          </FormButton>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-10 text-center text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
          No schedules found. Create one to automate workflow runs.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700/60">
            <thead className="bg-slate-50/70 dark:bg-slate-800/70">
              <tr>
                <th className={TABLE_HEADER_CLASSES}>Workflow</th>
                <th className={TABLE_HEADER_CLASSES}>Name</th>
                <th className={TABLE_HEADER_CLASSES}>Cron</th>
                <th className={TABLE_HEADER_CLASSES}>Timezone</th>
                <th className={TABLE_HEADER_CLASSES}>Next Run</th>
                <th className={TABLE_HEADER_CLASSES}>Catch Up</th>
                <th className={TABLE_HEADER_CLASSES}>Active</th>
                <th className={TABLE_HEADER_CLASSES}>Parameters</th>
                <th className={TABLE_HEADER_CLASSES}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white/80 dark:divide-slate-700/60 dark:bg-slate-900/40">
              {schedules.map((entry) => (
                <tr key={entry.schedule.id}>
                  <td className={TABLE_CELL_CLASSES}>
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{entry.workflow.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{entry.workflow.slug}</span>
                    </div>
                  </td>
                  <td className={TABLE_CELL_CLASSES}>{entry.schedule.name ?? '—'}</td>
                  <td className={TABLE_CELL_CLASSES}>
                    <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {entry.schedule.cron}
                    </code>
                  </td>
                  <td className={TABLE_CELL_CLASSES}>{entry.schedule.timezone ?? '—'}</td>
                  <td className={TABLE_CELL_CLASSES}>{formatNextRun(entry.schedule)}</td>
                  <td className={TABLE_CELL_CLASSES}>{entry.schedule.catchUp ? 'Yes' : 'No'}</td>
                  <td className={TABLE_CELL_CLASSES}>{entry.schedule.isActive ? 'Yes' : 'No'}</td>
                  <td className={`${TABLE_CELL_CLASSES} max-w-xs whitespace-pre-wrap`}>{formatParameters(entry.schedule.parameters)}</td>
                  <td className={`${TABLE_CELL_CLASSES} w-32`}
                  >
                    <div className="flex flex-wrap gap-2">
                      <FormButton
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenEdit(entry)}
                      >
                        Edit
                      </FormButton>
                      <FormButton
                        variant="tertiary"
                        size="sm"
                        onClick={() => void handleDelete(entry)}
                      >
                        Delete
                      </FormButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ScheduleFormDialog
        mode={formState.mode}
        open={formState.open}
        schedule={formState.schedule}
        workflows={workflowOptions}
        submitting={submitting}
        onClose={handleFormClose}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
