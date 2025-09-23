import { useEffect, useMemo } from 'react';
import { FormField } from '../../components/form';
import type { JobBundleVersionSummary, JobDefinitionSummary, ServiceSummary } from '../api';
import type { WorkflowDraftStep } from '../types';
import type { DraftValidationIssue } from './state';

function generateOptionLabel(name: string | undefined, slug: string): string {
  if (!name || name === slug) {
    return slug;
  }
  return `${name} (${slug})`;
}

type BundleBinding = {
  slug: string;
  version: string | null;
  exportName: string | null;
};

const BUNDLE_ENTRY_REGEX = /^bundle:([a-z0-9][a-z0-9._-]*)@([^#]+?)(?:#([a-zA-Z_$][\w$]*))?$/i;

function parseBundleEntryPoint(entryPoint: string | null | undefined): BundleBinding | null {
  if (!entryPoint) {
    return null;
  }
  const trimmed = entryPoint.trim();
  if (!trimmed) {
    return null;
  }
  const matches = BUNDLE_ENTRY_REGEX.exec(trimmed);
  if (!matches) {
    return null;
  }
  const [, slug, version, exportName] = matches;
  if (!slug || !version) {
    return null;
  }
  return {
    slug: slug.toLowerCase(),
    version: version.trim() || null,
    exportName: exportName ?? null
  } satisfies BundleBinding;
}

function parseRegistryRef(value: string | null | undefined): { slug: string; version: string | null } | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const [slug, ...versionParts] = trimmed.split('@');
  if (!slug) {
    return null;
  }
  const version = versionParts.join('@') || null;
  return {
    slug: slug.toLowerCase(),
    version
  };
}

function getJobBundleBinding(job: JobDefinitionSummary | undefined): BundleBinding | null {
  if (!job) {
    return null;
  }
  const entryBinding = parseBundleEntryPoint(job.entryPoint);
  if (entryBinding) {
    return entryBinding;
  }

  const registryBinding = parseRegistryRef(job.registryRef);
  if (registryBinding) {
    return {
      slug: registryBinding.slug,
      version: registryBinding.version,
      exportName: null
    } satisfies BundleBinding;
  }

  return null;
}

function deriveBundleDefaults(
  step: WorkflowDraftStep,
  job: JobDefinitionSummary | undefined
): { slug: string; version: string | null; exportName: string | null } {
  const existing = step.bundle ?? undefined;
  if (existing) {
    const slug = existing.slug?.trim().toLowerCase() ?? '';
    const version = existing.version ?? null;
    const exportName = existing.exportName ?? null;
    return {
      slug,
      version,
      exportName
    };
  }

  const jobBinding = getJobBundleBinding(job);
  if (jobBinding) {
    return jobBinding;
  }

  return {
    slug: '',
    version: null,
    exportName: null
  };
}

export type BundleVersionState = {
  versions: JobBundleVersionSummary[];
  loading: boolean;
  error: string | null;
};

type WorkflowStepCardProps = {
  step: WorkflowDraftStep;
  index: number;
  allSteps: WorkflowDraftStep[];
  jobs: JobDefinitionSummary[];
  services: ServiceSummary[];
  bundleVersionState: Record<string, BundleVersionState>;
  onLoadBundleVersions: (slug: string) => Promise<JobBundleVersionSummary[] | void>;
  errors?: DraftValidationIssue[];
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
  bundleVersionState,
  onLoadBundleVersions,
  errors = [],
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown
}: WorkflowStepCardProps) {
  const otherSteps = useMemo(
    () => allSteps.filter((candidate) => candidate.id !== step.id),
    [allSteps, step.id]
  );

  const selectedJob = useMemo(
    () => jobs.find((job) => job.slug === step.jobSlug),
    [jobs, step.jobSlug]
  );

  const bundleDefaults = useMemo(
    () => deriveBundleDefaults(step, selectedJob),
    [step, selectedJob]
  );

  const bundleStrategy: 'latest' | 'pinned' = step.bundle?.strategy === 'pinned' ? 'pinned' : 'latest';
  const bundleSlug = step.bundle?.slug ?? bundleDefaults.slug ?? '';
  const normalizedBundleSlug = bundleSlug.trim().toLowerCase();
  const bundleVersion = step.bundle?.version ?? bundleDefaults.version ?? '';
  const bundleExportName = step.bundle?.exportName ?? bundleDefaults.exportName ?? '';
  const bundleVersionInfo = normalizedBundleSlug ? bundleVersionState[normalizedBundleSlug] : undefined;
  const versionOptions = useMemo(() => {
    const base = bundleVersionInfo?.versions ?? [];
    if (bundleVersion && !base.some((entry) => entry.version === bundleVersion)) {
      return [
        {
          id: `current-${bundleVersion}`,
          version: bundleVersion,
          status: null,
          immutable: false,
          publishedAt: null,
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z'
        } satisfies JobBundleVersionSummary,
        ...base
      ];
    }
    return base;
  }, [bundleVersion, bundleVersionInfo?.versions]);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const issue of errors) {
      const key = issue.path.startsWith(`${step.id}.`) ? issue.path.slice(step.id.length + 1) : issue.path;
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(issue.message);
    }
    return map;
  }, [errors, step.id]);

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
    const nextJob = jobs.find((job) => job.slug === value);
    onUpdate((current) => {
      if (!value) {
        return { ...current, jobSlug: '', bundle: undefined };
      }
      const strategy = current.bundle?.strategy === 'pinned' ? 'pinned' : 'latest';
      const jobBinding = getJobBundleBinding(nextJob);
      const slug = (jobBinding?.slug ?? current.bundle?.slug ?? '').trim().toLowerCase();
      const versionValue = strategy === 'pinned' ? current.bundle?.version ?? jobBinding?.version ?? '' : null;
      const exportName = current.bundle?.exportName ?? jobBinding?.exportName ?? null;
      return {
        ...current,
        jobSlug: value,
        bundle: {
          strategy,
          slug,
          version: versionValue,
          exportName
        }
      } satisfies WorkflowDraftStep;
    });
  };

  const handleBundleStrategyChange = (strategy: 'latest' | 'pinned') => {
    onUpdate((current) => {
      const jobBinding = getJobBundleBinding(selectedJob);
      const slug = (current.bundle?.slug ?? jobBinding?.slug ?? '').trim().toLowerCase();
      const exportName = current.bundle?.exportName ?? jobBinding?.exportName ?? null;
      const nextBundle = {
        strategy,
        slug,
        version: strategy === 'pinned' ? current.bundle?.version ?? jobBinding?.version ?? '' : null,
        exportName
      };
      return { ...current, bundle: nextBundle };
    });
  };

  const handleBundleSlugChange = (value: string) => {
    const normalized = value.trim().toLowerCase();
    onUpdate((current) => {
      const strategy = current.bundle?.strategy === 'pinned' ? 'pinned' : 'latest';
      const jobBinding = getJobBundleBinding(selectedJob);
      const exportName = current.bundle?.exportName ?? jobBinding?.exportName ?? null;
      const versionValue = strategy === 'pinned'
        ? current.bundle?.version ?? jobBinding?.version ?? ''
        : null;
      return {
        ...current,
        bundle: {
          strategy,
          slug: normalized,
          version: versionValue,
          exportName
        }
      } satisfies WorkflowDraftStep;
    });
  };

  const handleBundleVersionChange = (value: string) => {
    const normalized = value.trim();
    onUpdate((current) => {
      const jobBinding = getJobBundleBinding(selectedJob);
      const exportName = current.bundle?.exportName ?? jobBinding?.exportName ?? null;
      const slug = (current.bundle?.slug ?? jobBinding?.slug ?? '').trim().toLowerCase();
      return {
        ...current,
        bundle: {
          strategy: 'pinned',
          slug,
          version: normalized,
          exportName
        }
      } satisfies WorkflowDraftStep;
    });
  };

  const handleBundleExportNameChange = (value: string) => {
    const normalized = value.trim();
    onUpdate((current) => {
      const strategy = current.bundle?.strategy === 'pinned' ? 'pinned' : 'latest';
      const jobBinding = getJobBundleBinding(selectedJob);
      const slug = (current.bundle?.slug ?? jobBinding?.slug ?? '').trim().toLowerCase();
      const versionValue = strategy === 'pinned' ? current.bundle?.version ?? jobBinding?.version ?? '' : null;
      return {
        ...current,
        bundle: {
          strategy,
          slug,
          version: versionValue,
          exportName: normalized ? normalized : null
        }
      } satisfies WorkflowDraftStep;
    });
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

  useEffect(() => {
    if (bundleStrategy !== 'pinned') {
      return;
    }
    if (!normalizedBundleSlug) {
      return;
    }
    void onLoadBundleVersions(normalizedBundleSlug);
  }, [bundleStrategy, normalizedBundleSlug, onLoadBundleVersions]);

  useEffect(() => {
    if (bundleStrategy !== 'pinned') {
      return;
    }
    if (!normalizedBundleSlug) {
      return;
    }
    if (!bundleVersionInfo || bundleVersionInfo.loading) {
      return;
    }
    if (!bundleVersionInfo.versions || bundleVersionInfo.versions.length === 0) {
      return;
    }
    const currentVersion = typeof step.bundle?.version === 'string' ? step.bundle.version.trim() : '';
    if (!currentVersion) {
      handleBundleVersionChange(bundleVersionInfo.versions[0].version);
    }
  }, [bundleStrategy, bundleVersionInfo, normalizedBundleSlug, step.bundle?.version]);

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
          {fieldErrors['id'] && (
            <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors['id'][0]}</p>
          )}
        </FormField>
        <FormField label="Display name" htmlFor={`step-${step.id}-name`}>
          <input
            id={`step-${step.id}-name`}
            type="text"
            value={step.name}
            onChange={(event) => handleNameChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
          />
          {fieldErrors['name'] && (
            <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors['name'][0]}</p>
          )}
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
          <>
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
              {fieldErrors['jobSlug'] && (
                <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors['jobSlug'][0]}</p>
              )}
            </FormField>
            <div className="md:col-span-2 space-y-4">
              <FormField
                label="Bundle version"
                hint="Choose whether this step should always track the latest bundle or pin to a specific release."
              >
                <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <label className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${
                    bundleStrategy === 'latest'
                      ? 'border-violet-400 bg-violet-500/10 text-violet-600 dark:border-slate-300 dark:text-slate-100'
                      : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                  }`}
                  >
                    <input
                      type="radio"
                      name={`step-${step.id}-bundle-strategy`}
                      value="latest"
                      checked={bundleStrategy === 'latest'}
                      onChange={() => handleBundleStrategyChange('latest')}
                      className="h-4 w-4 text-violet-600 focus:ring-violet-500"
                    />
                    <span>Latest (default)</span>
                  </label>
                  <label className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${
                    bundleStrategy === 'pinned'
                      ? 'border-violet-400 bg-violet-500/10 text-violet-600 dark:border-slate-300 dark:text-slate-100'
                      : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                  }`}
                  >
                    <input
                      type="radio"
                      name={`step-${step.id}-bundle-strategy`}
                      value="pinned"
                      checked={bundleStrategy === 'pinned'}
                      onChange={() => handleBundleStrategyChange('pinned')}
                      className="h-4 w-4 text-violet-600 focus:ring-violet-500"
                    />
                    <span>Pin to version</span>
                  </label>
                </div>
                {bundleStrategy === 'latest' && selectedJob && (
                  <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Runs using the bundle configured on the job definition
                    {bundleDefaults.version ? ` (${bundleDefaults.version})` : ''}.
                  </p>
                )}
              </FormField>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Bundle slug" htmlFor={`step-${step.id}-bundle-slug`}>
                  <input
                    id={`step-${step.id}-bundle-slug`}
                    type="text"
                    value={bundleSlug}
                    onChange={(event) => handleBundleSlugChange(event.target.value)}
                    placeholder="bundle-slug"
                    className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                  />
                  {fieldErrors['bundle.slug'] && (
                    <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors['bundle.slug'][0]}</p>
                  )}
                </FormField>
                {bundleStrategy === 'pinned' && (
                  <FormField
                    label="Pinned version"
                    htmlFor={`step-${step.id}-bundle-version`}
                    hint="Provide the semantic version to lock this workflow to."
                  >
                    <select
                      id={`step-${step.id}-bundle-version`}
                      value={bundleVersion ?? ''}
                      onChange={(event) => handleBundleVersionChange(event.target.value)}
                      disabled={Boolean(bundleVersionInfo?.loading) || versionOptions.length === 0}
                      className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:disabled:bg-slate-800"
                    >
                      <option value="">
                        {bundleVersionInfo?.loading
                          ? 'Loading versions…'
                          : versionOptions.length > 0
                            ? 'Select a version…'
                            : 'No versions available'}
                      </option>
                      {versionOptions.map((version) => (
                        <option key={version.id} value={version.version}>
                          {version.version}
                        </option>
                      ))}
                    </select>
                    {bundleVersionInfo?.error && (
                      <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                        {bundleVersionInfo.error}
                      </p>
                    )}
                    {fieldErrors['bundle.version'] && (
                      <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors['bundle.version'][0]}</p>
                    )}
                  </FormField>
                )}
              </div>

              <FormField
                label="Exported handler (optional)"
                htmlFor={`step-${step.id}-bundle-export`}
                hint="Populate when the bundle exposes multiple handlers. Leave empty to call the default export."
              >
                <input
                  id={`step-${step.id}-bundle-export`}
                  type="text"
                  value={bundleExportName ?? ''}
                  onChange={(event) => handleBundleExportNameChange(event.target.value)}
                  placeholder="handlerName"
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                />
              </FormField>
            </div>
          </>
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
            {fieldErrors['serviceSlug'] && (
            <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors['serviceSlug'][0]}</p>
            )}
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
