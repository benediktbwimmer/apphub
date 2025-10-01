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
import {
  ALERT_DANGER,
  CARD_CONDENSED,
  CARD_SECTION,
  COUNTER_BADGE,
  COUNTER_VALUE_BADGE,
  DESTRUCTIVE_BUTTON,
  PANEL_SURFACE,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON_LARGE,
  SECTION_LABEL,
  HEADING_PRIMARY,
  HEADING_SECONDARY,
  STATUS_BADGE_DANGER,
  STATUS_BADGE_INFO,
  STATUS_BADGE_NEUTRAL,
  STATUS_BADGE_SUCCESS,
  STEP_CARD_ACTIVE,
  STEP_CARD_BASE,
  STEP_CARD_COMPLETE,
  STEP_CARD_PENDING,
  SUBTEXT
} from './importTokens';

export type ImportWorkspaceProps = {
  onAppRegistered?: (id: string) => void;
  onManifestImported?: () => void;
  onViewCore?: () => void;
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
  onViewCore
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
    coreLoading,
    coreError,
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

  const bundleStatusClass = useCallback((status: ExampleBundleStatus | null) => {
    if (!status) {
      return STATUS_BADGE_NEUTRAL;
    }
    if (status.state === 'failed') {
      return STATUS_BADGE_DANGER;
    }
    if (status.state === 'completed') {
      return STATUS_BADGE_SUCCESS;
    }
    return STATUS_BADGE_INFO;
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
            onViewCore={onViewCore}
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
            <span className={SECTION_LABEL}>Import wizard</span>
            <h1 className={HEADING_PRIMARY}>
              Bring services, apps, jobs, and workflows online in sequence
            </h1>
            <p className={SUBTEXT}>
              Move through each stage, resolve example dependencies automatically, and validate imports before operators rely on them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={handleOpenPicker}
              disabled={coreLoading || scenarios.length === 0}
            >
              Load example
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON_LARGE}
              onClick={handleLoadAllExamples}
              disabled={coreLoading || !hasLoadAllScenario}
            >
              Load all examples
            </button>
            {coreLoading ? (
              <span className={SUBTEXT}>Loading examples…</span>
            ) : coreError ? (
              <span className="text-scale-xs font-weight-semibold text-status-danger">Examples unavailable</span>
            ) : null}
            <div className={COUNTER_BADGE}>
              <span>Loaded</span>
              <span className={COUNTER_VALUE_BADGE}>
                Services {loadedScenarioCounts.services}
              </span>
              <span className={COUNTER_VALUE_BADGE}>
                Apps {loadedScenarioCounts.apps}
              </span>
              <span className={COUNTER_VALUE_BADGE}>
                Jobs {loadedScenarioCounts.jobs}
              </span>
              <span className={COUNTER_VALUE_BADGE}>
                Workflows {loadedScenarioCounts.workflows}
              </span>
            </div>
          </div>
        </header>

        {autoImportState.status === 'running' ? (
          <div className={CARD_CONDENSED}>
            <span className="inline-flex h-4 w-4 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
            <span>{autoImportState.step ?? 'Importing selected examples…'}</span>
          </div>
        ) : null}

        {autoImportState.status === 'error' && autoImportState.errors.length > 0 ? (
          <div className={ALERT_DANGER}>
            <span className={SECTION_LABEL}>Example import issues</span>
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
                const stateClasses = isCurrent
                  ? STEP_CARD_ACTIVE
                  : isComplete
                    ? STEP_CARD_COMPLETE
                    : STEP_CARD_PENDING;
                const badgeClass = stepCounts[step] > 0 ? STATUS_BADGE_SUCCESS : STATUS_BADGE_NEUTRAL;
                return (
                  <li key={step}>
                    <button
                      type="button"
                      className={`${STEP_CARD_BASE} ${stateClasses}`}
                      onClick={() => setActiveStep(step)}
                    >
                      <div className="flex flex-col gap-1">
                        <span className={SECTION_LABEL}>Step {index + 1}</span>
                        <span className={HEADING_SECONDARY}>{STEP_LABELS[step]}</span>
                        <span className={SUBTEXT}>{STEP_HELP_TEXT[step]}</span>
                      </div>
                      <span className={badgeClass}>{stepCounts[step]} loaded</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section className={`${PANEL_SURFACE} flex flex-col gap-6`}>
            {hasDependencies ? (
              <div className={`${CARD_SECTION} gap-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className={SECTION_LABEL}>Dependencies</span>
                    <span className={SUBTEXT}>{STEP_LABELS[activeStep]} requires these resources to complete.</span>
                  </div>
                  {bundleStatusLoading ? (
                    <span className={SUBTEXT}>Refreshing status…</span>
                  ) : null}
                </div>
                {bundleStatusError ? (
                  <p className={ALERT_DANGER}>{bundleStatusError}</p>
                ) : null}
                <div className="flex flex-col gap-3">
                  {dependencyEntries.map(({ step, scenarios }) => (
                    <div key={step} className="flex flex-col gap-2">
                      <span className={SECTION_LABEL}>{STEP_LABELS[step]}</span>
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
                          const badgeClass = step === 'jobs'
                            ? bundleStatusClass(bundleStatus)
                            : loaded
                              ? STATUS_BADGE_SUCCESS
                              : STATUS_BADGE_NEUTRAL;
                          return (
                            <li key={scenario.id} className={`${CARD_SECTION} gap-2`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-col">
                                  <span className={HEADING_SECONDARY}>{scenario.title}</span>
                                  <span className={SUBTEXT}>{scenario.summary}</span>
                                </div>
                                <span className={badgeClass}>
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
                              {bundleStatus?.message ? <p className={SUBTEXT}>{bundleStatus.message}</p> : null}
                              {awaitingPackaging ? (
                                <p className={SUBTEXT}>
                                  Packaging will start automatically when the queue picks up this example.
                                </p>
                              ) : null}
                              {bundleStatus?.error ? (
                                <p className="text-scale-xs text-status-danger">{bundleStatus.error}</p>
                              ) : null}
                              {retrySlug && bundleStatus?.state === 'failed' ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className={DESTRUCTIVE_BUTTON}
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
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-4">
              <button
                type="button"
                className={SECONDARY_BUTTON_LARGE}
                onClick={() => previousStep && setActiveStep(previousStep)}
                disabled={!previousStep}
              >
                Back
              </button>
              <div className="flex items-center gap-2">
                <span className={SUBTEXT}>
                  Stage {currentIndex + 1} of {STEP_ORDER.length}
                </span>
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
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
