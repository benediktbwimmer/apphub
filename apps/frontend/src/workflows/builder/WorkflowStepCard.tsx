import { useMemo } from 'react';
import { FormField } from '../../components/form';
import type { JobDefinitionSummary, ServiceSummary } from '../api';
import type { WorkflowDraftStep } from '../types';

function generateOptionLabel(name: string | undefined, slug: string): string {
  if (!name || name === slug) {
    return slug;
  }
  return `${name} (${slug})`;
}

type WorkflowStepCardProps = {
  step: WorkflowDraftStep;
  index: number;
  allSteps: WorkflowDraftStep[];
  jobs: JobDefinitionSummary[];
  services: ServiceSummary[];
  onUpdate: (updater: (current: WorkflowDraftStep) => WorkflowDraftStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

export function WorkflowStepCard({
  step,
  index,
  allSteps,
  jobs,
  services,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown
}: WorkflowStepCardProps) {
  const otherSteps = useMemo(
    () => allSteps.filter((candidate) => candidate.id !== step.id),
    [allSteps, step.id]
  );

  const handleIdChange = (value: string) => {
    const trimmed = value.trim();
    onUpdate((current) => ({ ...current, id: trimmed }));
  };

  const handleNameChange = (value: string) => {
    onUpdate((current) => ({ ...current, name: value }));
  };

  const handleTypeChange = (value: WorkflowDraftStep['type']) => {
    if (value === step.type) {
      return;
    }
    if (value === 'service') {
      onUpdate((current) => ({
        ...current,
        type: 'service',
        serviceSlug: current.serviceSlug ?? '',
        jobSlug: undefined,
        request: current.request ?? { path: '/', method: 'GET' },
        requestBodyText: current.requestBodyText ?? ''
      }));
    } else {
      onUpdate((current) => ({
        ...current,
        type: 'job',
        jobSlug: current.jobSlug ?? '',
        serviceSlug: undefined,
        request: undefined,
        requestBodyText: undefined,
        requestBodyError: undefined
      }));
    }
  };

  const handleJobChange = (value: string) => {
    onUpdate((current) => ({ ...current, jobSlug: value }));
  };

  const handleServiceChange = (value: string) => {
    onUpdate((current) => ({ ...current, serviceSlug: value }));
  };

  const toggleDependency = (dependencyId: string) => {
    onUpdate((current) => {
      const dependsOn = current.dependsOn ?? [];
      if (dependsOn.includes(dependencyId)) {
        return { ...current, dependsOn: dependsOn.filter((entry) => entry !== dependencyId) };
      }
      return { ...current, dependsOn: [...dependsOn, dependencyId] };
    });
  };

  const handleTimeoutChange = (value: string) => {
    if (!value) {
      onUpdate((current) => ({ ...current, timeoutMs: null }));
      return;
    }
    const numeric = Number(value);
    onUpdate((current) => ({ ...current, timeoutMs: Number.isNaN(numeric) ? current.timeoutMs ?? null : numeric }));
  };

  const handleStoreResultChange = (value: string) => {
    onUpdate((current) => ({ ...current, storeResultAs: value.trim() || undefined }));
  };

  const handleParametersChange = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      onUpdate((current) => ({
        ...current,
        parameters: {},
        parametersText: '',
        parametersError: null
      }));
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      onUpdate((current) => ({
        ...current,
        parameters: parsed,
        parametersText: value,
        parametersError: null
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      onUpdate((current) => ({
        ...current,
        parametersText: value,
        parametersError: message
      }));
    }
  };

  const handleRequestPathChange = (value: string) => {
    onUpdate((current) => ({
      ...current,
      request: {
        ...(current.request ?? { path: '/', method: 'GET' }),
        path: value
      }
    }));
  };

  const handleRequestMethodChange = (value: string) => {
    onUpdate((current) => ({
      ...current,
      request: {
        ...(current.request ?? { path: '/', method: 'GET' }),
        method: value
      }
    }));
  };

  const handleRequestBodyChange = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      onUpdate((current) => ({
        ...current,
        request: {
          ...(current.request ?? { path: '/', method: 'GET' }),
          body: undefined
        },
        requestBodyText: '',
        requestBodyError: null
      }));
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      onUpdate((current) => ({
        ...current,
        request: {
          ...(current.request ?? { path: '/', method: 'GET' }),
          body: parsed
        },
        requestBodyText: value,
        requestBodyError: null
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      onUpdate((current) => ({
        ...current,
        requestBodyText: value,
        requestBodyError: message
      }));
    }
  };

  const handleCheckboxToggle = (field: keyof WorkflowDraftStep) => (checked: boolean) => {
    onUpdate((current) => ({ ...current, [field]: checked }));
  };

  const jobOptions = useMemo(
    () =>
      jobs
        .slice()
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((job) => ({ value: job.slug, label: generateOptionLabel(job.name, job.slug) })),
    [jobs]
  );

  const serviceOptions = useMemo(
    () =>
      services
        .slice()
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((service) => ({
          value: service.slug,
          label: generateOptionLabel(service.displayName ?? undefined, service.slug)
        })),
    [services]
  );

  const dependsOn = new Set(step.dependsOn ?? []);

  return (
    <div className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Step {index + 1}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Configure workflow execution step.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMoveUp}
            className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-60 disabled:hover:bg-white/70 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            disabled={index === 0}
          >
            Move up
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-60 disabled:hover:bg-white/70 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            disabled={index === allSteps.length - 1}
          >
            Move down
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-rose-300/70 bg-rose-50/80 px-3 py-1 text-xs font-semibold text-rose-600 transition-colors hover:border-rose-400 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-rose-500/60 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:bg-rose-500/25"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <FormField label="Step ID" htmlFor={`step-${step.id}-id`}>
          <input
            id={`step-${step.id}-id`}
            type="text"
            value={step.id}
            onChange={(event) => handleIdChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          />
        </FormField>
        <FormField label="Display name" htmlFor={`step-${step.id}-name`}>
          <input
            id={`step-${step.id}-name`}
            type="text"
            value={step.name}
            onChange={(event) => handleNameChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          />
        </FormField>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Step kind" htmlFor={`step-${step.id}-type`}>
          <select
            id={`step-${step.id}-type`}
            value={step.type}
            onChange={(event) => handleTypeChange(event.target.value as WorkflowDraftStep['type'])}
            className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          >
            <option value="job">Job step</option>
            <option value="service">Service step</option>
          </select>
        </FormField>
        {step.type === 'job' ? (
          <FormField label="Job definition" htmlFor={`step-${step.id}-job`}>
            <select
              id={`step-${step.id}-job`}
              value={step.jobSlug ?? ''}
              onChange={(event) => handleJobChange(event.target.value)}
              className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            >
              <option value="">Select a job…</option>
              {jobOptions.map((job) => (
                <option key={job.value} value={job.value}>
                  {job.label}
                </option>
              ))}
            </select>
          </FormField>
        ) : (
          <FormField label="Service" htmlFor={`step-${step.id}-service`}>
            <select
              id={`step-${step.id}-service`}
              value={step.serviceSlug ?? ''}
              onChange={(event) => handleServiceChange(event.target.value)}
              className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            >
              <option value="">Select a service…</option>
              {serviceOptions.map((service) => (
                <option key={service.value} value={service.value}>
                  {service.label}
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>

      <FormField label="Description" htmlFor={`step-${step.id}-description`}>
        <textarea
          id={`step-${step.id}-description`}
          value={step.description ?? ''}
          onChange={(event) => onUpdate((current) => ({ ...current, description: event.target.value }))}
          className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          rows={2}
        />
      </FormField>

      <FormField label="Depends on">
        <div className="flex flex-wrap gap-2">
          {otherSteps.length === 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">No other steps yet.</span>
          )}
          {otherSteps.map((candidate) => {
            const checked = dependsOn.has(candidate.id);
            return (
              <label
                key={candidate.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  checked
                    ? 'border-violet-400 bg-violet-500/10 text-violet-600 dark:border-slate-300 dark:text-slate-100'
                    : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDependency(candidate.id)}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span>{candidate.name || candidate.id}</span>
              </label>
            );
          })}
        </div>
      </FormField>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Timeout (ms)" htmlFor={`step-${step.id}-timeout`}>
          <input
            id={`step-${step.id}-timeout`}
            type="number"
            min={0}
            value={step.timeoutMs ?? ''}
            onChange={(event) => handleTimeoutChange(event.target.value)}
            placeholder="e.g. 60000"
            className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          />
        </FormField>
        {step.type === 'job' && (
          <FormField label="Store result as" htmlFor={`step-${step.id}-store`}>
            <input
              id={`step-${step.id}-store`}
              type="text"
              value={step.storeResultAs ?? ''}
              onChange={(event) => handleStoreResultChange(event.target.value)}
              placeholder="Optional JSON pointer"
              className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            />
          </FormField>
        )}
      </div>

      <FormField label="Parameters JSON" hint="Provide step parameters as JSON object.">
        <textarea
          value={step.parametersText ?? ''}
          onChange={(event) => handleParametersChange(event.target.value)}
          rows={5}
          className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm font-mono text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          spellCheck={false}
        />
        {step.parametersError && (
          <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{step.parametersError}</p>
        )}
      </FormField>

      {step.type === 'service' && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="HTTP method" htmlFor={`step-${step.id}-method`}>
              <select
                id={`step-${step.id}-method`}
                value={(step.request as { method?: string } | undefined)?.method ?? 'GET'}
                onChange={(event) => handleRequestMethodChange(event.target.value)}
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
                <option value="HEAD">HEAD</option>
              </select>
            </FormField>
            <FormField label="Request path" htmlFor={`step-${step.id}-path`}>
              <input
                id={`step-${step.id}-path`}
                type="text"
                value={(step.request as { path?: string } | undefined)?.path ?? ''}
                onChange={(event) => handleRequestPathChange(event.target.value)}
                placeholder="/api/v1/run"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              />
            </FormField>
          </div>

          <FormField label="Request body" hint="Optional JSON body sent to the service.">
            <textarea
              value={step.requestBodyText ?? ''}
              onChange={(event) => handleRequestBodyChange(event.target.value)}
              rows={4}
              className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm font-mono text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              spellCheck={false}
            />
            {step.requestBodyError && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{step.requestBodyError}</p>
            )}
          </FormField>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(step.requireHealthy)}
                onChange={(event) => handleCheckboxToggle('requireHealthy')(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Require healthy
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(step.allowDegraded)}
                onChange={(event) => handleCheckboxToggle('allowDegraded')(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Allow degraded
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(step.captureResponse)}
                onChange={(event) => handleCheckboxToggle('captureResponse')(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Capture response payload
            </label>
            <FormField label="Store response as" htmlFor={`step-${step.id}-store-response`}>
              <input
                id={`step-${step.id}-store-response`}
                type="text"
                value={step.storeResponseAs ?? ''}
                onChange={(event) =>
                  onUpdate((current) => ({ ...current, storeResponseAs: event.target.value.trim() || undefined }))
                }
                placeholder="responsePayload"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              />
            </FormField>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkflowStepCard;
