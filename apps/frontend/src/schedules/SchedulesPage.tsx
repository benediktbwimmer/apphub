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
import {
  SCHEDULE_ALERT_DANGER,
  SCHEDULE_EMPTY_STATE,
  SCHEDULE_PAGE_CARD,
  SCHEDULE_PAGE_SUBTITLE,
  SCHEDULE_PAGE_TITLE,
  SCHEDULE_STATUS_BADGE_ACTIVE,
  SCHEDULE_STATUS_BADGE_PAUSED,
  SCHEDULE_TABLE_CELL,
  SCHEDULE_TABLE_HEADER
} from './scheduleTokens';

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
      .map((workflow) => ({
        id: workflow.id,
        slug: workflow.slug,
        name: workflow.name,
        defaultParameters: workflow.defaultParameters
      }));
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
          <h1 className={SCHEDULE_PAGE_TITLE}>Schedules</h1>
          <p className={SCHEDULE_PAGE_SUBTITLE}>Review and manage automated workflow schedules.</p>
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
        <div className={SCHEDULE_ALERT_DANGER}>{error}</div>
      ) : schedules.length === 0 ? (
        <div className={SCHEDULE_EMPTY_STATE}>No schedules found. Create one to automate workflow runs.</div>
      ) : (
        <div className={SCHEDULE_PAGE_CARD}>
          <table className="min-w-full divide-y divide-subtle text-left">
            <thead>
              <tr>
                <th className={SCHEDULE_TABLE_HEADER}>Workflow</th>
                <th className={SCHEDULE_TABLE_HEADER}>Name</th>
                <th className={SCHEDULE_TABLE_HEADER}>Cron</th>
                <th className={SCHEDULE_TABLE_HEADER}>Timezone</th>
                <th className={SCHEDULE_TABLE_HEADER}>Next Run</th>
                <th className={SCHEDULE_TABLE_HEADER}>Catch Up</th>
                <th className={SCHEDULE_TABLE_HEADER}>Active</th>
                <th className={SCHEDULE_TABLE_HEADER}>Parameters</th>
                <th className={SCHEDULE_TABLE_HEADER}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {schedules.map((entry) => (
                <tr key={entry.schedule.id}>
                  <td className={SCHEDULE_TABLE_CELL}>
                    <div className="flex flex-col gap-1">
                      <span className="text-scale-sm font-weight-semibold text-primary">{entry.workflow.name}</span>
                      <span className={SCHEDULE_PAGE_SUBTITLE}>{entry.workflow.slug}</span>
                    </div>
                  </td>
                  <td className={SCHEDULE_TABLE_CELL}>{entry.schedule.name ?? '—'}</td>
                  <td className={SCHEDULE_TABLE_CELL}>
                    <code className="rounded bg-surface-muted px-2 py-1 text-scale-xs text-secondary">
                      {entry.schedule.cron}
                    </code>
                  </td>
                  <td className={SCHEDULE_TABLE_CELL}>{entry.schedule.timezone ?? '—'}</td>
                  <td className={SCHEDULE_TABLE_CELL}>{formatNextRun(entry.schedule)}</td>
                  <td className={SCHEDULE_TABLE_CELL}>
                    {entry.schedule.catchUp ? (
                      <span className={SCHEDULE_STATUS_BADGE_ACTIVE}>Enabled</span>
                    ) : (
                      <span className={SCHEDULE_STATUS_BADGE_PAUSED}>Disabled</span>
                    )}
                  </td>
                  <td className={SCHEDULE_TABLE_CELL}>
                    {entry.schedule.isActive ? (
                      <span className={SCHEDULE_STATUS_BADGE_ACTIVE}>Active</span>
                    ) : (
                      <span className={SCHEDULE_STATUS_BADGE_PAUSED}>Paused</span>
                    )}
                  </td>
                  <td className={`${SCHEDULE_TABLE_CELL} max-w-xs whitespace-pre-wrap`}>{formatParameters(entry.schedule.parameters)}</td>
                  <td className={`${SCHEDULE_TABLE_CELL} w-32`}>
                    <div className="flex flex-wrap gap-2">
                      <FormButton variant="secondary" size="sm" onClick={() => handleOpenEdit(entry)}>
                        Edit
                      </FormButton>
                      <FormButton variant="tertiary" size="sm" onClick={() => void handleDelete(entry)}>
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
