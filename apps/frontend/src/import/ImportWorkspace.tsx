import { useEffect, useMemo, useState } from 'react';
import ServiceManifestsTab from './tabs/ServiceManifestsTab';
import ImportAppsTab from './tabs/ImportAppsTab';
import ImportJobBundleTab from './tabs/ImportJobBundleTab';
import {
  ExampleScenarioPicker,
  EXAMPLE_SCENARIOS,
  type ExampleScenario,
  type ServiceManifestScenario,
  type AppScenario,
  type JobScenario,
  type ExampleScenarioType
} from './examples';
import { useAnalytics } from '../utils/useAnalytics';

export type ImportSubtab = 'service-manifests' | 'apps' | 'jobs';

type ImportWorkspaceProps = {
  onAppRegistered?: (id: string) => void;
  onManifestImported?: () => void;
  onViewCatalog?: () => void;
};

const SUBTAB_STORAGE_KEY = 'apphub-import-active-subtab';
const SCENARIO_STORAGE_KEY = 'apphub-import-example-scenarios';

const SUBTAB_LABELS: Record<ImportSubtab, string> = {
  'service-manifests': 'Service manifests',
  apps: 'Apps',
  jobs: 'Jobs'
};

const SUBTAB_FOR_SCENARIO: Record<ExampleScenarioType, ImportSubtab> = {
  'service-manifest': 'service-manifests',
  app: 'apps',
  job: 'jobs'
};

const SCENARIO_TYPE_FOR_SUBTAB: Record<ImportSubtab, ExampleScenarioType> = {
  'service-manifests': 'service-manifest',
  apps: 'app',
  jobs: 'job'
};

type ScenarioRequest<TScenario> = {
  scenario: TScenario;
  token: number;
};

type StoredScenarioIds = Partial<Record<ImportSubtab, string>>;

function findScenarioById<TScenario extends ExampleScenario>(
  id: string,
  type: ExampleScenarioType
): TScenario | null {
  const match = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === id && candidate.type === type);
  if (!match) {
    return null;
  }
  return match as TScenario;
}

function readStoredScenarios(): StoredScenarioIds {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const entries = Object.entries(parsed).filter((entry): entry is [ImportSubtab, string] => {
      const [key, value] = entry;
      return isImportSubtab(key) && typeof value === 'string' && value.length > 0;
    });
    return Object.fromEntries(entries) as StoredScenarioIds;
  } catch {
    return {};
  }
}

function persistStoredScenarios(value: StoredScenarioIds) {
  if (typeof window === 'undefined') {
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    window.localStorage.removeItem(SCENARIO_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(value));
}

function isImportSubtab(value: unknown): value is ImportSubtab {
  return value === 'service-manifests' || value === 'apps' || value === 'jobs';
}

const TAB_BUTTON_CLASSES =
  'rounded-full px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const TAB_ACTIVE_CLASSES = 'bg-violet-600 text-white shadow-lg shadow-violet-500/20 dark:bg-slate-200/30 dark:text-slate-50';

const TAB_INACTIVE_CLASSES =
  'text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

export default function ImportWorkspace({ onAppRegistered, onManifestImported, onViewCatalog }: ImportWorkspaceProps) {
  const { trackEvent } = useAnalytics();
  const [activeSubtab, setActiveSubtab] = useState<ImportSubtab>(() => {
    if (typeof window === 'undefined') {
      return 'service-manifests';
    }
    const stored = window.localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (isImportSubtab(stored)) {
      return stored;
    }
    return 'service-manifests';
  });
  const [storedScenarios, setStoredScenarios] = useState<StoredScenarioIds>(() => readStoredScenarios());
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [serviceScenario, setServiceScenario] = useState<ScenarioRequest<ServiceManifestScenario> | null>(() => {
    const storedId = readStoredScenarios()['service-manifests'];
    if (!storedId) {
      return null;
    }
    const scenario = findScenarioById<ServiceManifestScenario>(storedId, 'service-manifest');
    if (!scenario) {
      return null;
    }
    return { scenario, token: Date.now() };
  });
  const [appScenario, setAppScenario] = useState<ScenarioRequest<AppScenario> | null>(() => {
    const storedId = readStoredScenarios().apps;
    if (!storedId) {
      return null;
    }
    const scenario = findScenarioById<AppScenario>(storedId, 'app');
    if (!scenario) {
      return null;
    }
    return { scenario, token: Date.now() };
  });
  const [jobScenario, setJobScenario] = useState<ScenarioRequest<JobScenario> | null>(() => {
    const storedId = readStoredScenarios().jobs;
    if (!storedId) {
      return null;
    }
    const scenario = findScenarioById<JobScenario>(storedId, 'job');
    if (!scenario) {
      return null;
    }
    return { scenario, token: Date.now() };
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  useEffect(() => {
    persistStoredScenarios(storedScenarios);
  }, [storedScenarios]);

  const activeScenarioIds = useMemo(
    () => ({
      'service-manifest': serviceScenario?.scenario.id ?? null,
      app: appScenario?.scenario.id ?? null,
      job: jobScenario?.scenario.id ?? null
    }),
    [serviceScenario, appScenario, jobScenario]
  );

  const handleScenarioStoredUpdate = (subtab: ImportSubtab, id: string | null) => {
    setStoredScenarios((prev) => {
      const next: StoredScenarioIds = { ...prev };
      if (id) {
        next[subtab] = id;
      } else {
        delete next[subtab];
      }
      return next;
    });
  };

  const handleApplyScenario = (scenario: ExampleScenario) => {
    trackEvent('import_example_applied', {
      scenarioId: scenario.id,
      scenarioType: scenario.type,
      scenarioTag: scenario.analyticsTag ?? null
    });
    const targetSubtab = SUBTAB_FOR_SCENARIO[scenario.type];
    setActiveSubtab(targetSubtab);
    const token = Date.now();
    if (scenario.type === 'service-manifest') {
      setServiceScenario({ scenario, token });
    } else if (scenario.type === 'app') {
      setAppScenario({ scenario, token });
    } else {
      setJobScenario({ scenario, token });
    }
    handleScenarioStoredUpdate(targetSubtab, scenario.id);
    setScenarioPickerOpen(false);
  };

  const handleScenarioCleared = (subtab: ImportSubtab) => {
    const scenarioType = SCENARIO_TYPE_FOR_SUBTAB[subtab];
    const currentScenario =
      scenarioType === 'service-manifest'
        ? serviceScenario?.scenario
        : scenarioType === 'app'
          ? appScenario?.scenario
          : jobScenario?.scenario;
    if (currentScenario) {
      trackEvent('import_example_cleared', {
        scenarioId: currentScenario.id,
        scenarioType,
        scenarioTag: currentScenario.analyticsTag ?? null
      });
    }
    if (subtab === 'service-manifests') {
      setServiceScenario(null);
    } else if (subtab === 'apps') {
      setAppScenario(null);
    } else {
      setJobScenario(null);
    }
    handleScenarioStoredUpdate(subtab, null);
  };

  const handleOpenPicker = () => {
    trackEvent('import_example_picker_opened');
    setScenarioPickerOpen(true);
  };

  const handleClosePicker = () => {
    setScenarioPickerOpen(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-500 dark:text-violet-300">
            Import workspace
          </span>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Manage manifests, register apps, and publish jobs
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Validate assets, resolve dependencies, and confirm imports before they reach operators and runtime
            environments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-slate-100/80 p-1 dark:border-slate-700/70 dark:bg-slate-800/70">
            {(Object.keys(SUBTAB_LABELS) as ImportSubtab[]).map((subtab) => {
              const isActive = subtab === activeSubtab;
              return (
                <button
                  key={subtab}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`${TAB_BUTTON_CLASSES} ${isActive ? TAB_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES}`}
                  onClick={() => setActiveSubtab(subtab)}
                >
                  {SUBTAB_LABELS[subtab]}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-slate-900/20 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-100/90 dark:text-slate-900 dark:hover:bg-slate-200"
            onClick={handleOpenPicker}
          >
            Load example
          </button>
        </div>
      </header>

      {activeSubtab === 'service-manifests' && (
        <ServiceManifestsTab
          onImported={onManifestImported}
          scenario={serviceScenario?.scenario ?? null}
          scenarioRequestToken={serviceScenario?.token}
          onScenarioCleared={() => handleScenarioCleared('service-manifests')}
        />
      )}
      {activeSubtab === 'apps' && (
        <ImportAppsTab
          onAppRegistered={onAppRegistered}
          onViewCatalog={onViewCatalog}
          scenario={appScenario?.scenario ?? null}
          scenarioRequestToken={appScenario?.token}
          onScenarioCleared={() => handleScenarioCleared('apps')}
        />
      )}
      {activeSubtab === 'jobs' && (
        <ImportJobBundleTab
          scenario={jobScenario?.scenario ?? null}
          scenarioRequestToken={jobScenario?.token}
          onScenarioCleared={() => handleScenarioCleared('jobs')}
        />
      )}

      <ExampleScenarioPicker
        open={scenarioPickerOpen}
        scenarios={EXAMPLE_SCENARIOS}
        activeScenarioIds={activeScenarioIds}
        onClose={handleClosePicker}
        onApply={handleApplyScenario}
      />
    </div>
  );
}
