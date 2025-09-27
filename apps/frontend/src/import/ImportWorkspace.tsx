import { useCallback, useMemo, useState } from 'react';
import { ExampleScenarioPicker, type ExampleScenario, type ExampleScenarioType } from './examples';
import ServiceManifestsTab from './tabs/ServiceManifestsTab';
import ImportAppsTab from './tabs/ImportAppsTab';
import ImportJobBundleTab from './tabs/ImportJobBundleTab';
import ImportWorkflowTab from './tabs/ImportWorkflowTab';
import { ServicePlaceholderDialog } from './components/ServicePlaceholderDialog';
import { useToasts } from '../components/toast';
import { useExampleBundleProgress } from './useExampleBundleProgress';
import type { ExampleBundleStatus } from './exampleBundles';
import type { ExampleBundlerProgressStage } from '@apphub/example-bundler';
import {
  STEP_LABELS,
  STEP_ORDER,
  type ImportWizardStep,
  useImportWizardController
} from './useImportWizardController';

export type ImportWorkspaceProps = {
  onAppRegistered?: (id: string) => void;
  onManifestImported?: () => void;
  onViewCatalog?: () => void;
};

const STEP_HELP_TEXT: Record<ImportWizardStep, string> = {
  'service-manifests': 'Register foundational service networks and runtime configuration.',
  apps: 'Connect containerized apps so builds and launches can target your workspace.',
  jobs: 'Upload or reference job bundles to keep automation assets in sync.',
  workflows: 'Define orchestration logic that stitches services, jobs, and assets together.'
};

const SCENARIO_STEP_MAP: Partial<Record<ExampleScenarioType, ImportWizardStep>> = {
  'service-manifest': 'service-manifests',
  app: 'apps',
  job: 'jobs',
  workflow: 'workflows'
};

const BUNDLE_STAGE_LABELS: Record<ExampleBundlerProgressStage, string> = {
  queued: 'Queued',
  resolving: 'Resolving manifest',
  'cache-hit': 'Cache hit',
  'installing-dependencies': 'Installing dependencies',
  packaging: 'Packaging',
  completed: 'Packaged',
  failed: 'Failed'
};

type DependencyMap = Record<ImportWizardStep, ExampleScenario[]>;

function createEmptyDependencyMap(): DependencyMap {
  return {
    'service-manifests': [],
    apps: [],
    jobs: [],
    workflows: []
  };
}

function collectDependencies(
  scenario: ExampleScenario | null,
  lookup: Map<string, ExampleScenario>
): DependencyMap {
  if (!scenario) {
    return createEmptyDependencyMap();
  }

  const result = createEmptyDependencyMap();
  const visited = new Set<string>();

  const visit = (identifier: string) => {
    const normalized = identifier.trim();
    if (!normalized || visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    const candidate = lookup.get(normalized);
    if (!candidate) {
      return;
    }
    if (candidate.type === 'scenario') {
      candidate.includes.forEach(visit);
      return;
    }
    const step = SCENARIO_STEP_MAP[candidate.type];
    if (step) {
      result[step].push(candidate);
    }
    const nestedIncludes = (candidate as { includes?: string[] }).includes;
    if (Array.isArray(nestedIncludes)) {
      nestedIncludes.forEach(visit);
    }
  };

  const includes = (scenario as { includes?: string[] }).includes;
  if (Array.isArray(includes)) {
    includes.forEach(visit);
  }

  (Object.keys(result) as ImportWizardStep[]).forEach((step) => {
    result[step] = result[step].filter((candidate, index, arr) =>
      arr.findIndex((entry) => entry.id === candidate.id) === index
    )
      .sort((a, b) => a.title.localeCompare(b.title));
  });

  return result;
}

function determineStepStatus(
  step: ImportWizardStep,
  activeStep: ImportWizardStep,
  counts: Record<ImportWizardStep, number>
) {
  const isCurrent = step === activeStep;
  const isComplete = counts[step] > 0;
  return { isCurrent, isComplete };
}

export default function ImportWorkspace({
  onAppRegistered,
  onManifestImported,
  onViewCatalog
}: ImportWorkspaceProps) {
  const {
    activeStep,
    setActiveStep,
    scenarioPickerOpen,
    handleOpenPicker,
    handleClosePicker,
    handleApplyScenario,
    handleScenarioCleared,
    handleScenarioSelected,
    handleLoadAllExamples,
    serviceScenarioState,
    appScenarioState,
    jobScenarioState,
    workflowScenarioState,
    scenarioOptions,
    catalogLoading,
    catalogError,
    scenarios,
    activeScenarioIds,
    loadedScenarioCounts,
    autoImportState,
    servicePlaceholderModal,
    serviceModalSubmitting,
    serviceModalError,
    handleServiceModalVariableChange,
    handleServiceModalSubmit,
    handleServiceModalCancel
  } = useImportWizardController();

  const { pushToast } = useToasts();
  const {
    loading: bundleStatusLoading,
    error: bundleStatusError,
    getStatus: getBundleStatus,
    retryBundle
  } = useExampleBundleProgress();
  const [retryingSlug, setRetryingSlug] = useState<string | null>(null);

  const scenarioLookup = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios]
  );

  const activeScenario = useMemo<ExampleScenario | null>(() => {
    switch (activeStep) {
      case 'service-manifests':
        return serviceScenarioState.active?.scenario ?? null;
      case 'apps':
        return appScenarioState.active?.scenario ?? null;
      case 'jobs':
        return jobScenarioState.active?.scenario ?? null;
      case 'workflows':
        return workflowScenarioState.active?.scenario ?? null;
      default:
        return null;
    }
  }, [
    activeStep,
    serviceScenarioState.active,
    appScenarioState.active,
    jobScenarioState.active,
    workflowScenarioState.active
  ]);

  const dependencyMap = useMemo(
    () => collectDependencies(activeScenario, scenarioLookup),
    [activeScenario, scenarioLookup]
  );

  const dependencyEntries = useMemo(
    () =>
      STEP_ORDER.map((step) => ({ step, scenarios: dependencyMap[step] })).filter(
        (entry) => entry.scenarios.length > 0
      ),
    [dependencyMap]
  );

  const hasDependencies = dependencyEntries.length > 0;

  const hasLoadAllScenario = useMemo(
    () =>
      scenarios.some(
        (entry) => entry.type === 'scenario' && entry.analyticsTag === 'bundle__all_examples'
      ),
    [scenarios]
  );

  const isScenarioEnqueued = useCallback(
    (step: ImportWizardStep, scenarioId: string) => {
      switch (step) {
        case 'service-manifests':
          return serviceScenarioState.all.some((entry) => entry.scenario.id === scenarioId);
        case 'apps':
          return appScenarioState.all.some((entry) => entry.scenario.id === scenarioId);
        case 'jobs':
          return jobScenarioState.all.some((entry) => entry.scenario.id === scenarioId);
        case 'workflows':
          return workflowScenarioState.all.some((entry) => entry.scenario.id === scenarioId);
        default:
          return false;
      }
    },
    [
      serviceScenarioState.all,
      appScenarioState.all,
      jobScenarioState.all,
      workflowScenarioState.all
    ]
  );

  const bundleStatusLabel = useCallback((status: ExampleBundleStatus | null) => {
    if (!status) {
      return 'Awaiting packaging';
    }
    if (status.state === 'failed') {
      return 'Failed';
    }
    if (status.state === 'completed') {
      return 'Packaged';
    }
    return BUNDLE_STAGE_LABELS[status.stage] ?? 'In progress';
  }, []);

  const bundleStatusTone = useCallback((status: ExampleBundleStatus | null) => {
    if (!status) {
      return 'bg-slate-200/80 text-slate-600 dark:bg-slate-700/60 dark:text-slate-200';
    }
    if (status.state === 'failed') {
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
    }
    if (status.state === 'completed') {
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
    }
    return 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200';
  }, []);

  const isBundleRunning = useCallback((status: ExampleBundleStatus | null) => {
    if (!status) {
      return false;
    }
    return status.state === 'running' || (status.state === 'queued' && status.stage === 'queued');
  }, []);

  const handleRetryExampleBundle = useCallback(
    async (slug: string, title: string) => {
      setRetryingSlug(slug);
      try {
        await retryBundle(slug);
        pushToast({
          tone: 'success',
          title: 'Packaging retried',
          description: `${title} re-queued for packaging.`
        });
      } catch (err) {
        pushToast({
          tone: 'error',
          title: 'Retry failed',
          description: err instanceof Error ? err.message : String(err)
        });
      } finally {
        setRetryingSlug((prev) => (prev === slug ? null : prev));
      }
    },
    [retryBundle, pushToast]
  );

  const stepCounts: Record<ImportWizardStep, number> = useMemo(
    () => ({
      'service-manifests': loadedScenarioCounts.services,
      apps: loadedScenarioCounts.apps,
      jobs: loadedScenarioCounts.jobs,
      workflows: loadedScenarioCounts.workflows
    }),
    [loadedScenarioCounts]
  );

  const stepStatuses = useMemo(
    () =>
      STEP_ORDER.map((step) => ({
        step,
        status: determineStepStatus(step, activeStep, stepCounts)
      })),
    [activeStep, stepCounts]
  );

  const currentIndex = STEP_ORDER.indexOf(activeStep);
  const previousStep = currentIndex > 0 ? STEP_ORDER[currentIndex - 1] : null;
  const nextStep = currentIndex < STEP_ORDER.length - 1 ? STEP_ORDER[currentIndex + 1] : null;

  const stepContent = (() => {
    switch (activeStep) {
      case 'service-manifests':
        return (
          <ServiceManifestsTab
            onImported={onManifestImported}
            scenario={serviceScenarioState.active?.scenario ?? null}
            scenarioRequestToken={serviceScenarioState.active?.token}
            onScenarioCleared={() => handleScenarioCleared('service-manifests')}
            scenarioOptions={scenarioOptions.service}
            activeScenarioId={serviceScenarioState.active?.scenario.id ?? null}
            onScenarioSelected={(id) => handleScenarioSelected('service-manifests', id)}
          />
        );
      case 'apps':
        return (
          <ImportAppsTab
            onAppRegistered={onAppRegistered}
            onViewCatalog={onViewCatalog}
            scenario={appScenarioState.active?.scenario ?? null}
            scenarioRequestToken={appScenarioState.active?.token}
            onScenarioCleared={() => handleScenarioCleared('apps')}
            scenarioOptions={scenarioOptions.app}
            activeScenarioId={appScenarioState.active?.scenario.id ?? null}
            onScenarioSelected={(id) => handleScenarioSelected('apps', id)}
          />
        );
      case 'jobs':
        return (
          <ImportJobBundleTab
            scenario={jobScenarioState.active?.scenario ?? null}
            scenarioRequestToken={jobScenarioState.active?.token}
            onScenarioCleared={() => handleScenarioCleared('jobs')}
            scenarioOptions={scenarioOptions.job}
            activeScenarioId={jobScenarioState.active?.scenario.id ?? null}
            onScenarioSelected={(id) => handleScenarioSelected('jobs', id)}
          />
        );
      case 'workflows':
      default:
        return (
          <ImportWorkflowTab
            scenario={workflowScenarioState.active?.scenario ?? null}
            scenarioRequestToken={workflowScenarioState.active?.token}
            onScenarioCleared={() => handleScenarioCleared('workflows')}
            scenarioOptions={scenarioOptions.workflow}
            activeScenarioId={workflowScenarioState.active?.scenario.id ?? null}
            onScenarioSelected={(id) => handleScenarioSelected('workflows', id)}
          />
        );
    }
  })();

  return (
    <>
      <ServicePlaceholderDialog
        open={Boolean(servicePlaceholderModal)}
        scenario={servicePlaceholderModal?.scenario ?? null}
        placeholders={servicePlaceholderModal?.placeholders ?? []}
        variables={servicePlaceholderModal?.variables ?? {}}
        onChange={handleServiceModalVariableChange}
        onSubmit={handleServiceModalSubmit}
        onCancel={handleServiceModalCancel}
        submitting={serviceModalSubmitting}
        error={serviceModalError}
      />

      <ExampleScenarioPicker
        open={scenarioPickerOpen}
        scenarios={scenarios}
        activeScenarioIds={activeScenarioIds}
        onClose={handleClosePicker}
        onApply={handleApplyScenario}
      />

      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-500 dark:text-violet-300">
              Import wizard
            </span>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Bring services, apps, jobs, and workflows online in sequence
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Move through each stage, resolve example dependencies automatically, and validate imports before operators rely on them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-slate-900/20 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100/90 dark:text-slate-900 dark:hover:bg-slate-200"
              onClick={handleOpenPicker}
              disabled={catalogLoading || scenarios.length === 0}
            >
              Load example
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-400/60 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-400 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:border-violet-300 dark:hover:text-violet-200"
              onClick={handleLoadAllExamples}
              disabled={catalogLoading || !hasLoadAllScenario}
            >
              Load all examples
            </button>
            {catalogLoading ? (
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Loading examples…
              </span>
            ) : catalogError ? (
              <span className="text-xs font-medium text-rose-500 dark:text-rose-400">
                Examples unavailable
              </span>
            ) : null}
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
              <span>Loaded</span>
              <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200">
                Services {loadedScenarioCounts.services}
              </span>
              <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200">
                Apps {loadedScenarioCounts.apps}
              </span>
              <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200">
                Jobs {loadedScenarioCounts.jobs}
              </span>
              <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200">
                Workflows {loadedScenarioCounts.workflows}
              </span>
            </div>
          </div>
        </header>

        {autoImportState.status === 'running' ? (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-3 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
            <span className="inline-flex h-4 w-4 animate-spin rounded-full border-[3px] border-violet-500 border-t-transparent" />
            <span className="text-slate-600 dark:text-slate-300">
              {autoImportState.step ?? 'Importing selected examples…'}
            </span>
          </div>
        ) : null}

        {autoImportState.status === 'error' && autoImportState.errors.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-rose-300/70 bg-rose-50/80 p-3 text-sm shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-50">
            <span className="text-xs font-semibold uppercase tracking-[0.3em]">Example import issues</span>
            <ul className="list-disc space-y-1 pl-5">
              {autoImportState.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.38fr)_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3">
              {stepStatuses.map(({ step, status }, index) => {
                const { isCurrent, isComplete } = status;
                const baseClasses =
                  'flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
                const stateClasses = isCurrent
                  ? 'border-violet-500 bg-violet-50/90 text-violet-700 shadow-sm shadow-violet-500/20 dark:border-violet-400/60 dark:bg-violet-500/10 dark:text-violet-100'
                  : isComplete
                    ? 'border-emerald-400/60 bg-emerald-50/80 text-emerald-700 hover:border-emerald-500 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100'
                    : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-violet-300 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200';
                return (
                  <li key={step}>
                    <button
                      type="button"
                      className={`${baseClasses} ${stateClasses}`}
                      onClick={() => setActiveStep(step)}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                          Step {index + 1}
                        </span>
                        <span className="text-sm font-semibold">{STEP_LABELS[step]}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{STEP_HELP_TEXT[step]}</span>
                      </div>
                      <span className="rounded-full border border-slate-200/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:border-slate-600 dark:text-slate-300">
                        {stepCounts[step]} loaded
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section className="flex flex-col gap-6 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
            {hasDependencies ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                      Dependencies
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {STEP_LABELS[activeStep]} requires these resources to complete.
                    </span>
                  </div>
                  {bundleStatusLoading ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">Refreshing status…</span>
                  ) : null}
                </div>
                {bundleStatusError ? (
                  <p className="rounded-xl border border-rose-300/70 bg-rose-50/80 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
                    {bundleStatusError}
                  </p>
                ) : null}
                <div className="flex flex-col gap-3">
                  {dependencyEntries.map(({ step, scenarios }) => (
                    <div key={step} className="flex flex-col gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                        {STEP_LABELS[step]}
                      </span>
                      <ul className="flex flex-col gap-2">
                        {scenarios.map((scenario) => {
                          const loaded = isScenarioEnqueued(step, scenario.id);
                          const bundleStatus =
                            step === 'jobs' && scenario.type === 'job' && scenario.exampleSlug
                              ? getBundleStatus(scenario.exampleSlug)
                              : null;
                          const awaitingPackaging =
                            step === 'jobs' && scenario.type === 'job' && scenario.exampleSlug && !bundleStatus;
                          const retrySlug = scenario.type === 'job' ? scenario.exampleSlug ?? null : null;
                          return (
                            <li
                              key={scenario.id}
                              className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/60"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {scenario.title}
                                  </span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {scenario.summary}
                                  </span>
                                </div>
                                <span
                                  className={"inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold " + (step === 'jobs' ? bundleStatusTone(bundleStatus) : loaded ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700/60 dark:text-slate-200')}
                                >
                                  {step === 'jobs'
                                    ? bundleStatusLabel(bundleStatus)
                                    : loaded
                                      ? 'Enqueued'
                                      : 'Pending'}
                                  {step === 'jobs' && isBundleRunning(bundleStatus) ? (
                                    <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[2px] border-current border-t-transparent" />
                                  ) : null}
                                </span>
                              </div>
                              {bundleStatus?.message ? (
                                <p className="text-xs text-slate-500 dark:text-slate-300">{bundleStatus.message}</p>
                              ) : awaitingPackaging ? (
                                <p className="text-xs text-slate-500 dark:text-slate-300">
                                  Packaging will start automatically when the queue picks up this example.
                                </p>
                              ) : null}
                              {bundleStatus?.error ? (
                                <p className="text-xs text-rose-600 dark:text-rose-300">{bundleStatus.error}</p>
                              ) : null}
                              {retrySlug && bundleStatus?.state === 'failed' ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-full border border-rose-400/60 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:border-rose-500 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-200 dark:hover:border-rose-400"
                                    onClick={() => handleRetryExampleBundle(retrySlug, scenario.title)}
                                    disabled={retryingSlug === retrySlug}
                                  >
                                    {retryingSlug === retrySlug ? 'Retrying…' : 'Retry packaging'}
                                  </button>
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {stepContent}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4 dark:border-slate-700/70">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
                onClick={() => previousStep && setActiveStep(previousStep)}
                disabled={!previousStep}
              >
                Back
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Stage {currentIndex + 1} of {STEP_ORDER.length}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/20 transition hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none dark:bg-violet-500 dark:text-slate-50 dark:hover:bg-violet-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
                  onClick={() => nextStep && setActiveStep(nextStep)}
                  disabled={!nextStep}
                >
                  Continue
                </button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </>
  );
}
