import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ServiceManifestsTab from './tabs/ServiceManifestsTab';
import ImportAppsTab from './tabs/ImportAppsTab';
import ImportJobBundleTab from './tabs/ImportJobBundleTab';
import ImportWorkflowTab from './tabs/ImportWorkflowTab';
import {
  ExampleScenarioPicker,
  EXAMPLE_SCENARIOS,
  type ExampleScenario,
  type ServiceManifestScenario,
  type AppScenario,
  type JobScenario,
  type WorkflowScenario,
  type ExampleScenarioType,
  groupScenariosByType
} from './examples';
import type { JobImportPreviewResult } from './useJobImportWorkflow';
import { useAnalytics } from '../utils/useAnalytics';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner } from '../components';
import { useToasts } from '../components/toast';
import { API_BASE_URL } from '../config';
import { fileToEncodedPayload } from '../utils/fileEncoding';

export type ImportSubtab = 'service-manifests' | 'apps' | 'jobs' | 'workflows';

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
  jobs: 'Jobs',
  workflows: 'Workflows'
};

const SUBTAB_FOR_SCENARIO: Partial<Record<ExampleScenarioType, ImportSubtab>> = {
  'service-manifest': 'service-manifests',
  app: 'apps',
  job: 'jobs',
  workflow: 'workflows'
};

const SCENARIO_TYPE_FOR_SUBTAB: Record<ImportSubtab, ExampleScenarioType> = {
  'service-manifests': 'service-manifest',
  apps: 'app',
  jobs: 'job',
  workflows: 'workflow'
};

type ScenarioRequest<TScenario> = {
  scenario: TScenario;
  token: number;
};

type ScenarioState<TScenario extends ExampleScenario> = {
  active: ScenarioRequest<TScenario> | null;
  all: ScenarioRequest<TScenario>[];
};

type StoredScenarioIds = Partial<Record<ImportSubtab, string>>;

type AutoImportState = {
  status: 'idle' | 'running' | 'success' | 'error';
  step: string | null;
  errors: string[];
};

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
  return value === 'service-manifests' || value === 'apps' || value === 'jobs' || value === 'workflows';
}

function createInitialScenarioState<TScenario extends ExampleScenario>(
  storedId: string | undefined,
  type: ExampleScenarioType
): ScenarioState<TScenario> {
  if (!storedId) {
    return { active: null, all: [] };
  }
  const scenario = findScenarioById<TScenario>(storedId, type);
  if (!scenario) {
    return { active: null, all: [] };
  }
  const request: ScenarioRequest<TScenario> = { scenario, token: Date.now() };
  return { active: request, all: [request] };
}

function emptyScenarioState<TScenario extends ExampleScenario>(): ScenarioState<TScenario> {
  return { active: null, all: [] };
}

function updateScenarioState<TScenario extends ExampleScenario>(
  prev: ScenarioState<TScenario>,
  scenario: TScenario,
  token: number,
  setActive: boolean
): ScenarioState<TScenario> {
  const request: ScenarioRequest<TScenario> = { scenario, token };
  const filtered = prev.all.filter((entry) => entry.scenario.id !== scenario.id);
  const all = [...filtered, request];
  const shouldActivate = setActive || !prev.active || prev.active.scenario.id === scenario.id;
  const active = shouldActivate ? request : prev.active ?? request;
  return { active, all };
}

const TAB_BUTTON_CLASSES =
  'rounded-full px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const TAB_ACTIVE_CLASSES = 'bg-violet-600 text-white shadow-lg shadow-violet-500/20 dark:bg-slate-200/30 dark:text-slate-50';

const TAB_INACTIVE_CLASSES =
  'text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

export default function ImportWorkspace({ onAppRegistered, onManifestImported, onViewCatalog }: ImportWorkspaceProps) {
  const { trackEvent } = useAnalytics();
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
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
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [serviceScenarioState, setServiceScenarioState] = useState<ScenarioState<ServiceManifestScenario>>(() =>
    createInitialScenarioState<ServiceManifestScenario>(readStoredScenarios()['service-manifests'], 'service-manifest')
  );
  const [appScenarioState, setAppScenarioState] = useState<ScenarioState<AppScenario>>(() =>
    createInitialScenarioState<AppScenario>(readStoredScenarios().apps, 'app')
  );
  const [jobScenarioState, setJobScenarioState] = useState<ScenarioState<JobScenario>>(() =>
    createInitialScenarioState<JobScenario>(readStoredScenarios().jobs, 'job')
  );
  const [workflowScenarioState, setWorkflowScenarioState] = useState<ScenarioState<WorkflowScenario>>(() =>
    createInitialScenarioState<WorkflowScenario>(readStoredScenarios().workflows, 'workflow')
  );
  const [lastScenarioBundleId, setLastScenarioBundleId] = useState<string | null>(null);
  const scenarioTokenRef = useRef(0);
  const autoImportedScenariosRef = useRef(new Set<string>());
  const [autoImportState, setAutoImportState] = useState<AutoImportState>({ status: 'idle', step: null, errors: [] });

  const getNextScenarioToken = useCallback(() => {
    scenarioTokenRef.current += 1;
    return Date.now() + scenarioTokenRef.current;
  }, []);

  const scenarioById = useMemo(() => new Map(EXAMPLE_SCENARIOS.map((entry) => [entry.id, entry])), []);

  const setAutoImportRunning = useCallback((step: string) => {
    setAutoImportState({ status: 'running', step, errors: [] });
  }, []);

  const completeAutoImport = useCallback((errors: string[]) => {
    if (errors.length === 0) {
      setAutoImportState({ status: 'success', step: null, errors: [] });
      pushToast({ tone: 'success', title: 'Examples imported', description: 'All example assets are ready to use.' });
      return;
    }
    setAutoImportState({ status: 'error', step: null, errors });
    pushToast({
      tone: 'error',
      title: 'Example import incomplete',
      description: 'Some example assets failed to import. Review the details below.'
    });
  }, [pushToast]);

  const importServiceManifestScenario = useCallback(
    async (scenario: ServiceManifestScenario) => {
      const body: {
        repo: string;
        ref?: string;
        commit?: string;
        configPath?: string;
        module?: string;
        variables?: Record<string, string>;
      } = { repo: scenario.form.repo };
      if (scenario.form.ref) {
        body.ref = scenario.form.ref;
      }
      if (scenario.form.commit) {
        body.commit = scenario.form.commit;
      }
      if (scenario.form.configPath) {
        body.configPath = scenario.form.configPath;
      }
      if (scenario.form.module) {
        body.module = scenario.form.module;
      }
      if (scenario.form.variables) {
        body.variables = scenario.form.variables;
      }
      const response = await authorizedFetch(`${API_BASE_URL}/service-networks/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (response.ok || response.status === 409) {
        return;
      }
      const payload = await response.json().catch(() => null);
      let message = typeof payload?.error === 'string' ? payload.error : `Service manifest import failed (${response.status})`;
      if (/service registry disabled/i.test(message)) {
        message = `${message}. Start the service registry worker (npm run dev:services) and retry.`;
      }
      throw new Error(message);
    },
    [authorizedFetch]
  );

  const importAppScenario = useCallback(
    async (scenario: AppScenario) => {
      const fallbackId = scenario.form.id?.trim().length ? scenario.form.id.trim() : scenario.id;
      const payload = {
        id: fallbackId,
        name: scenario.form.name,
        description: scenario.form.description,
        repoUrl: scenario.form.repoUrl,
        dockerfilePath: scenario.form.dockerfilePath,
        tags: scenario.form.tags ?? []
      };
      const response = await authorizedFetch(`${API_BASE_URL}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return;
      }
      if (response.status === 409) {
        return;
      }
      const data = await response.json().catch(() => null);
      const message = typeof data?.error === 'string' ? data.error : `App registration failed (${response.status})`;
      throw new Error(message);
    },
    [authorizedFetch]
  );

  const fetchBundleFile = useCallback(async (scenario: JobScenario) => {
    if (!scenario.bundle) {
      throw new Error('Bundle metadata missing for job scenario');
    }
    const assetBase = `${window.location.origin}${import.meta.env.BASE_URL ?? '/'}`;
    const normalizedPath = scenario.bundle.publicPath.startsWith('http')
      ? scenario.bundle.publicPath
      : new URL(
          scenario.bundle.publicPath.replace(/^\//, ''),
          assetBase.endsWith('/') ? assetBase : `${assetBase}/`
        ).toString();
    const response = await fetch(normalizedPath, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to download bundle archive (${response.status})`);
    }
    const blob = await response.blob();
    const filename = scenario.bundle.filename ?? `${scenario.id}.tgz`;
    const contentType = scenario.bundle.contentType ?? 'application/gzip';
    return new File([blob], filename, { type: contentType });
  }, []);

  const importJobScenario = useCallback(
    async (scenario: JobScenario) => {
      if (scenario.form.source === 'registry') {
        if (!scenario.form.reference?.trim()) {
          throw new Error('Registry reference missing for job scenario');
        }
        const requestBody = {
          source: 'registry' as const,
          reference: scenario.form.reference.trim(),
          notes: scenario.form.notes?.trim() || undefined
        };
        const previewResponse = await authorizedFetch(`${API_BASE_URL}/job-imports/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        if (!previewResponse.ok) {
          const payload = await previewResponse.json().catch(() => null);
          const message = typeof payload?.error === 'string' ? payload.error : `Preview failed (${previewResponse.status})`;
          throw new Error(message);
        }
        const confirmResponse = await authorizedFetch(`${API_BASE_URL}/job-imports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        if (!confirmResponse.ok && confirmResponse.status !== 409) {
          const payload = await confirmResponse.json().catch(() => null);
          const message = typeof payload?.error === 'string' ? payload.error : `Import failed (${confirmResponse.status})`;
          throw new Error(message);
        }
        return;
      }

      const isExample = Boolean(scenario.exampleSlug);

      const baseRequest: Record<string, unknown> = {
        source: isExample ? 'example' : 'upload',
        notes: scenario.form.notes?.trim() || undefined
      };

      if (isExample) {
        if (!scenario.exampleSlug) {
          throw new Error('Example bundle slug is missing.');
        }
        baseRequest.slug = scenario.exampleSlug;
        if (scenario.form.reference?.trim()) {
          baseRequest.reference = scenario.form.reference.trim();
        }
      } else {
        const archive = await fetchBundleFile(scenario);
        const archivePayload = await fileToEncodedPayload(archive);
        baseRequest.archive = archivePayload;
        if (scenario.form.reference?.trim()) {
          baseRequest.reference = scenario.form.reference.trim();
        }
      }

      const previewResponse = await authorizedFetch(`${API_BASE_URL}/job-imports/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseRequest)
      });
      const previewPayload = await previewResponse.json().catch(() => null);

      if (!previewResponse.ok) {
        const message = typeof previewPayload?.error === 'string'
          ? previewPayload.error
          : `Preview failed (${previewResponse.status})`;
        if (previewResponse.status === 409 || /already exists/i.test(message)) {
          return;
        }
        throw new Error(message);
      }

      const previewData = previewPayload?.data as JobImportPreviewResult | undefined;
      if (!previewData) {
        throw new Error('Preview response missing data');
      }
      if (previewData.errors && previewData.errors.length > 0) {
        throw new Error(previewData.errors.map((entry) => entry.message).join('\n'));
      }

      const confirmBody = {
        ...baseRequest,
        reference: `${previewData.bundle.slug}@${previewData.bundle.version}`
      };

      const confirmResponse = await authorizedFetch(`${API_BASE_URL}/job-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmBody)
      });
      if (confirmResponse.ok) {
        return;
      }
      const confirmPayload = await confirmResponse.json().catch(() => null);
      const message = typeof confirmPayload?.error === 'string' ? confirmPayload.error : `Import failed (${confirmResponse.status})`;
      if (confirmResponse.status === 409 || /already exists/i.test(message)) {
        return;
      }
      throw new Error(message);
    },
    [authorizedFetch, fetchBundleFile]
  );

  const importWorkflowScenario = useCallback(
    async (scenario: WorkflowScenario) => {
      const response = await authorizedFetch(`${API_BASE_URL}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario.form)
      });
      if (response.ok) {
        return;
      }
      if (response.status === 409) {
        return;
      }
      const payload = await response.json().catch(() => null);
      const message = typeof payload?.error === 'string' ? payload.error : `Workflow import failed (${response.status})`;
      throw new Error(message);
    },
    [authorizedFetch]
  );

  const autoImportIncludes = useCallback(
    async (bundleId: string, includeIds: string[]) => {
      if (includeIds.length === 0) {
        return;
      }
      if (autoImportedScenariosRef.current.has(bundleId)) {
        return;
      }
      autoImportedScenariosRef.current.add(bundleId);
      const scenarios = includeIds
        .map((id) => scenarioById.get(id))
        .filter((candidate): candidate is ExampleScenario => candidate !== undefined);
      if (scenarios.length === 0) {
        return;
      }

      const grouped = groupScenariosByType(scenarios);
      const totalItems =
        grouped['service-manifest'].length + grouped.app.length + grouped.job.length + grouped.workflow.length;
      if (totalItems === 0) {
        return;
      }
      const errors: string[] = [];

      if (grouped['service-manifest'].length > 0) {
        setAutoImportRunning('Importing service manifests');
        for (const scenario of grouped['service-manifest']) {
          try {
            await importServiceManifestScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      if (grouped.app.length > 0) {
        setAutoImportRunning('Registering example apps');
        for (const scenario of grouped.app) {
          try {
            await importAppScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      if (grouped.job.length > 0) {
        setAutoImportRunning('Uploading job bundles');
        for (const scenario of grouped.job) {
          try {
            await importJobScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      if (grouped.workflow.length > 0) {
        setAutoImportRunning('Creating workflows');
        for (const scenario of grouped.workflow) {
          try {
            await importWorkflowScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      completeAutoImport(errors);
    },
    [completeAutoImport, importAppScenario, importJobScenario, importServiceManifestScenario, importWorkflowScenario, scenarioById, setAutoImportRunning]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  useEffect(() => {
    const persisted: StoredScenarioIds = {};
    if (serviceScenarioState.active) {
      persisted['service-manifests'] = serviceScenarioState.active.scenario.id;
    }
    if (appScenarioState.active) {
      persisted.apps = appScenarioState.active.scenario.id;
    }
    if (jobScenarioState.active) {
      persisted.jobs = jobScenarioState.active.scenario.id;
    }
    if (workflowScenarioState.active) {
      persisted.workflows = workflowScenarioState.active.scenario.id;
    }
    persistStoredScenarios(persisted);
  }, [serviceScenarioState.active, appScenarioState.active, jobScenarioState.active, workflowScenarioState.active]);

  const activeScenarioIds = useMemo(
    () => ({
      'service-manifest': serviceScenarioState.active?.scenario.id ?? null,
      app: appScenarioState.active?.scenario.id ?? null,
      job: jobScenarioState.active?.scenario.id ?? null,
      workflow: workflowScenarioState.active?.scenario.id ?? null,
      scenario: lastScenarioBundleId
    }),
    [serviceScenarioState.active, appScenarioState.active, jobScenarioState.active, workflowScenarioState.active, lastScenarioBundleId]
  );

  const serviceScenarioOptions = useMemo(
    () => serviceScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
    [serviceScenarioState.all]
  );
  const appScenarioOptions = useMemo(
    () => appScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
    [appScenarioState.all]
  );
  const jobScenarioOptions = useMemo(
    () => jobScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
    [jobScenarioState.all]
  );
  const workflowScenarioOptions = useMemo(
    () => workflowScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
    [workflowScenarioState.all]
  );

  const loadedScenarioCounts = useMemo(
    () => ({
      services: serviceScenarioState.all.length,
      apps: appScenarioState.all.length,
      jobs: jobScenarioState.all.length,
      workflows: workflowScenarioState.all.length
    }),
    [appScenarioState.all, jobScenarioState.all, serviceScenarioState.all, workflowScenarioState.all]
  );

  const applyServiceScenario = useCallback(
    (scenario: ServiceManifestScenario, { setActive = true }: { setActive?: boolean } = {}) => {
      const token = getNextScenarioToken();
      setServiceScenarioState((prev) => updateScenarioState(prev, scenario, token, setActive));
    },
    [getNextScenarioToken]
  );

  const applyAppScenario = useCallback(
    (scenario: AppScenario, { setActive = true }: { setActive?: boolean } = {}) => {
      const token = getNextScenarioToken();
      setAppScenarioState((prev) => updateScenarioState(prev, scenario, token, setActive));
    },
    [getNextScenarioToken]
  );

  const applyJobScenario = useCallback(
    (scenario: JobScenario, { setActive = true }: { setActive?: boolean } = {}) => {
      const token = getNextScenarioToken();
      setJobScenarioState((prev) => updateScenarioState(prev, scenario, token, setActive));
    },
    [getNextScenarioToken]
  );

  const applyWorkflowScenario = useCallback(
    (scenario: WorkflowScenario, { setActive = true }: { setActive?: boolean } = {}) => {
      const token = getNextScenarioToken();
      setWorkflowScenarioState((prev) => updateScenarioState(prev, scenario, token, setActive));
    },
    [getNextScenarioToken]
  );

  const handleApplyScenario = useCallback(
    (scenario: ExampleScenario) => {
      if (scenario.type === 'scenario') {
        trackEvent('import_example_bundle_applied', {
          scenarioId: scenario.id,
          scenarioType: scenario.type,
          scenarioTag: scenario.analyticsTag ?? null,
          includeCount: scenario.includes.length
        });
        const includedScenarios = scenario.includes
          .map((id) => scenarioById.get(id) ?? null)
          .filter((entry): entry is ExampleScenario => entry !== null);

        const grouped = includedScenarios.reduce<{
          'service-manifest': ServiceManifestScenario[];
          app: AppScenario[];
          job: JobScenario[];
          workflow: WorkflowScenario[];
        }>(
          (acc, item) => {
            if (item.type === 'service-manifest') {
              acc['service-manifest'].push(item);
            } else if (item.type === 'app') {
              acc.app.push(item);
            } else if (item.type === 'job') {
              acc.job.push(item);
            } else if (item.type === 'workflow') {
              acc.workflow.push(item);
            }
            return acc;
          },
          { 'service-manifest': [], app: [], job: [], workflow: [] }
        );

        grouped['service-manifest'].forEach((entry, index) => applyServiceScenario(entry, { setActive: index === 0 }));
        grouped.app.forEach((entry, index) => applyAppScenario(entry, { setActive: index === 0 }));
        grouped.job.forEach((entry, index) => applyJobScenario(entry, { setActive: index === 0 }));
        grouped.workflow.forEach((entry, index) => applyWorkflowScenario(entry, { setActive: index === 0 }));

        setLastScenarioBundleId(scenario.id);
        setActiveSubtab(scenario.focus ?? 'workflows');
        setScenarioPickerOpen(false);
        void autoImportIncludes(scenario.id, scenario.includes);
        return;
      }

      trackEvent('import_example_applied', {
        scenarioId: scenario.id,
        scenarioType: scenario.type,
        scenarioTag: scenario.analyticsTag ?? null
      });

      const targetSubtab = SUBTAB_FOR_SCENARIO[scenario.type];
      const focusSubtab = targetSubtab ?? 'workflows';
      const relatedIds = Array.isArray((scenario as { includes?: unknown }).includes)
        ? ((scenario as { includes?: string[] }).includes ?? [])
        : [];
      if (relatedIds.length > 0) {
        const relatedScenarios = relatedIds
          .map((id) => scenarioById.get(id) ?? null)
          .filter((entry): entry is ExampleScenario => entry !== null && entry.type !== 'scenario');
        relatedScenarios.forEach((related) => {
          if (related.type === 'service-manifest') {
            applyServiceScenario(related as ServiceManifestScenario, { setActive: false });
          } else if (related.type === 'app') {
            applyAppScenario(related as AppScenario, { setActive: false });
          } else if (related.type === 'job') {
            applyJobScenario(related as JobScenario, { setActive: false });
          } else if (related.type === 'workflow') {
            applyWorkflowScenario(related as WorkflowScenario, { setActive: false });
          }
        });
      }
      if (scenario.type === 'service-manifest') {
        applyServiceScenario(scenario);
      } else if (scenario.type === 'app') {
        applyAppScenario(scenario);
      } else if (scenario.type === 'job') {
        applyJobScenario(scenario);
      } else if (scenario.type === 'workflow') {
        applyWorkflowScenario(scenario);
      }
      setLastScenarioBundleId(null);
      setActiveSubtab(focusSubtab);
      setScenarioPickerOpen(false);
      if (relatedIds.length > 0) {
        void autoImportIncludes(scenario.id, relatedIds);
      }
    },
    [applyAppScenario, applyJobScenario, applyServiceScenario, applyWorkflowScenario, autoImportIncludes, scenarioById, trackEvent]
  );

  const handleScenarioCleared = useCallback(
    (subtab: ImportSubtab) => {
      const scenarioType = SCENARIO_TYPE_FOR_SUBTAB[subtab];
      const currentScenario =
        subtab === 'service-manifests'
          ? serviceScenarioState.active?.scenario
          : subtab === 'apps'
            ? appScenarioState.active?.scenario
            : subtab === 'jobs'
              ? jobScenarioState.active?.scenario
              : workflowScenarioState.active?.scenario;
      if (currentScenario) {
        trackEvent('import_example_cleared', {
          scenarioId: currentScenario.id,
          scenarioType,
          scenarioTag: currentScenario.analyticsTag ?? null
        });
      }
      if (subtab === 'service-manifests') {
        setServiceScenarioState(emptyScenarioState());
      } else if (subtab === 'apps') {
        setAppScenarioState(emptyScenarioState());
      } else if (subtab === 'jobs') {
        setJobScenarioState(emptyScenarioState());
      } else if (subtab === 'workflows') {
        setWorkflowScenarioState(emptyScenarioState());
      }
    },
    [serviceScenarioState.active, appScenarioState.active, jobScenarioState.active, workflowScenarioState.active, trackEvent]
  );

  const handleScenarioSelected = useCallback(
    (subtab: ImportSubtab, scenarioId: string) => {
      const token = getNextScenarioToken();
      if (subtab === 'service-manifests') {
        const existing = serviceScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setServiceScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = findScenarioById<ServiceManifestScenario>(scenarioId, 'service-manifest');
        if (fallback) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setServiceScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
        return;
      }
      if (subtab === 'apps') {
        const existing = appScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setAppScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = findScenarioById<AppScenario>(scenarioId, 'app');
        if (fallback) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setAppScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
        return;
      }
      if (subtab === 'jobs') {
        const existing = jobScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setJobScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = findScenarioById<JobScenario>(scenarioId, 'job');
        if (fallback) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setJobScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
        return;
      }
      if (subtab === 'workflows') {
        const existing = workflowScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setWorkflowScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = findScenarioById<WorkflowScenario>(scenarioId, 'workflow');
        if (fallback) {
          trackEvent('import_example_switched', { subtab, scenarioId });
          setWorkflowScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
      }
    },
    [appScenarioState.all, getNextScenarioToken, jobScenarioState.all, serviceScenarioState.all, trackEvent, workflowScenarioState.all]
  );

  const handleOpenPicker = () => {
    trackEvent('import_example_picker_opened');
    setScenarioPickerOpen(true);
  };

  const handleClosePicker = () => {
    setScenarioPickerOpen(false);
  };

  const loadAllExamplesScenario = useMemo(
    () => EXAMPLE_SCENARIOS.find((entry) => entry.type === 'scenario' && entry.analyticsTag === 'bundle__all_examples') ?? null,
    []
  );

  const handleLoadAllExamples = useCallback(() => {
    if (loadAllExamplesScenario) {
      handleApplyScenario(loadAllExamplesScenario);
    }
  }, [handleApplyScenario, loadAllExamplesScenario]);

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
            Validate assets, resolve dependencies, and confirm imports before they reach operators and runtime environments.
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
          {loadAllExamplesScenario ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-400/60 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-400 hover:text-violet-600 dark:border-slate-600 dark:text-slate-200 dark:hover:border-violet-300 dark:hover:text-violet-200"
              onClick={handleLoadAllExamples}
            >
              Load all examples
            </button>
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
          <Spinner size="sm" label="Auto importing examples" />
          <span className="text-slate-600 dark:text-slate-300">{autoImportState.step ?? 'Importing examples…'}</span>
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

      {activeSubtab === 'service-manifests' && (
        <ServiceManifestsTab
          onImported={onManifestImported}
          scenario={serviceScenarioState.active?.scenario ?? null}
          scenarioRequestToken={serviceScenarioState.active?.token}
          onScenarioCleared={() => handleScenarioCleared('service-manifests')}
          scenarioOptions={serviceScenarioOptions}
          activeScenarioId={serviceScenarioState.active?.scenario.id ?? null}
          onScenarioSelected={(id) => handleScenarioSelected('service-manifests', id)}
        />
      )}
      {activeSubtab === 'apps' && (
        <ImportAppsTab
          onAppRegistered={onAppRegistered}
          onViewCatalog={onViewCatalog}
          scenario={appScenarioState.active?.scenario ?? null}
          scenarioRequestToken={appScenarioState.active?.token}
          onScenarioCleared={() => handleScenarioCleared('apps')}
          scenarioOptions={appScenarioOptions}
          activeScenarioId={appScenarioState.active?.scenario.id ?? null}
          onScenarioSelected={(id) => handleScenarioSelected('apps', id)}
        />
      )}
      {activeSubtab === 'jobs' && (
        <ImportJobBundleTab
          scenario={jobScenarioState.active?.scenario ?? null}
          scenarioRequestToken={jobScenarioState.active?.token}
          onScenarioCleared={() => handleScenarioCleared('jobs')}
          scenarioOptions={jobScenarioOptions}
          activeScenarioId={jobScenarioState.active?.scenario.id ?? null}
          onScenarioSelected={(id) => handleScenarioSelected('jobs', id)}
        />
      )}
      {activeSubtab === 'workflows' && (
        <ImportWorkflowTab
          scenario={workflowScenarioState.active?.scenario ?? null}
          scenarioRequestToken={workflowScenarioState.active?.token}
          onScenarioCleared={() => handleScenarioCleared('workflows')}
          scenarioOptions={workflowScenarioOptions}
          activeScenarioId={workflowScenarioState.active?.scenario.id ?? null}
          onScenarioSelected={(id) => handleScenarioSelected('workflows', id)}
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
