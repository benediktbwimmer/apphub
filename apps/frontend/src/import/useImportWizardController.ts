import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useAnalytics } from '../utils/useAnalytics';
import { useToasts } from '../components/toast';
import { API_BASE_URL } from '../config';
import {
  type AppScenario,
  type ExampleScenario,
  type ExampleScenarioType,
  type JobScenario,
  type ServiceManifestScenario,
  type WorkflowScenario,
  groupScenariosByType
} from './examples';
import {
  resolveWorkflowProvisioningPlan,
  type JsonValue,
  type WorkflowProvisioningEventTrigger,
  type WorkflowProvisioningSchedule
} from '@apphub/examples';

import type { ManifestPlaceholder } from './useImportServiceManifest';
import type { JobImportPreviewResult } from './useJobImportWorkflow';
import { fileToEncodedPayload } from '../utils/fileEncoding';

export type ImportWizardStep = 'service-manifests' | 'apps' | 'jobs' | 'workflows';

export const STEP_ORDER: ImportWizardStep[] = ['service-manifests', 'apps', 'jobs', 'workflows'];

export const STEP_LABELS: Record<ImportWizardStep, string> = {
  'service-manifests': 'Service manifests',
  apps: 'Apps',
  jobs: 'Jobs',
  workflows: 'Workflows'
};

export type WizardScenarioState<TScenario extends ExampleScenario> = {
  active: WizardScenarioRequest<TScenario> | null;
  all: WizardScenarioRequest<TScenario>[];
};

type WizardScenarioRequest<TScenario> = {
  scenario: TScenario;
  token: number;
};

export type AutoImportWizardState = {
  status: 'idle' | 'running' | 'success' | 'error';
  step: string | null;
  errors: string[];
};

type StoredScenarioIds = Partial<Record<ImportWizardStep, string>>;

export type ServicePlaceholderModalState = {
  scenario: ServiceManifestScenario;
  placeholders: ManifestPlaceholder[];
  variables: Record<string, string>;
  queue: ExampleImportQueue;
  errors: string[];
};

type ExampleImportQueue = {
  bundleId: string;
  service: ServiceManifestScenario[];
  app: AppScenario[];
  job: JobScenario[];
  workflow: WorkflowScenario[];
};

const SUBTAB_STORAGE_KEY = 'apphub-import-active-subtab';
const SCENARIO_STORAGE_KEY = 'apphub-import-example-scenarios';

const SUBTAB_FOR_SCENARIO: Partial<Record<ExampleScenarioType, ImportWizardStep>> = {
  'service-manifest': 'service-manifests',
  app: 'apps',
  job: 'jobs',
  workflow: 'workflows'
};

const SCENARIO_TYPE_FOR_STEP: Record<ImportWizardStep, ExampleScenarioType> = {
  'service-manifests': 'service-manifest',
  apps: 'app',
  jobs: 'job',
  workflows: 'workflow'
};

function mergeServiceVariables(
  base?: Record<string, string>,
  overrides?: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (base) {
    for (const [key, value] of Object.entries(base)) {
      merged[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      merged[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }
  return merged;
}

function normalizeVariablesForRequest(variables: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(variables)
    .map(([key, value]) => [key.trim(), (value ?? '').trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    normalized[key] = value;
  }
  return normalized;
}

function hydratePlaceholderVariables(
  placeholders: ManifestPlaceholder[],
  existing: Record<string, string>
): Record<string, string> {
  const hydrated: Record<string, string> = { ...existing };
  for (const placeholder of placeholders) {
    const name = placeholder.name;
    const existingValue = typeof hydrated[name] === 'string' ? hydrated[name].trim() : '';
    if (existingValue.length > 0) {
      hydrated[name] = existingValue;
      continue;
    }
    if (typeof placeholder.value === 'string' && placeholder.value.trim().length > 0) {
      hydrated[name] = placeholder.value.trim();
      continue;
    }
    if (typeof placeholder.defaultValue === 'string' && placeholder.defaultValue.trim().length > 0) {
      hydrated[name] = placeholder.defaultValue.trim();
      continue;
    }
    hydrated[name] = '';
  }
  return hydrated;
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
    const entries = Object.entries(parsed).filter((entry): entry is [ImportWizardStep, string] => {
      const [key, value] = entry;
      return isImportWizardStep(key) && typeof value === 'string' && value.length > 0;
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

function isImportWizardStep(value: unknown): value is ImportWizardStep {
  return value === 'service-manifests' || value === 'apps' || value === 'jobs' || value === 'workflows';
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}

function buildScheduleRequest(schedule: WorkflowProvisioningSchedule) {
  const parameters = schedule.parameters && Object.keys(schedule.parameters).length > 0
    ? schedule.parameters
    : undefined;
  return compactRecord({
    name: schedule.name,
    description: schedule.description,
    cron: schedule.cron,
    timezone: schedule.timezone ?? undefined,
    startWindow: schedule.startWindow ?? undefined,
    endWindow: schedule.endWindow ?? undefined,
    catchUp: schedule.catchUp ?? undefined,
    isActive: schedule.isActive ?? undefined,
    parameters
  });
}

function getMetadataValue(metadata: JsonValue | undefined, path: string): unknown {
  if (!isJsonObject(metadata)) {
    return undefined;
  }
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = metadata;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isNaN(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function pruneTriggerParameterTemplate(
  metadata: JsonValue | undefined,
  template: Record<string, JsonValue> | undefined
): Record<string, JsonValue> | undefined {
  if (!template || Object.keys(template).length === 0) {
    return undefined;
  }
  const result: Record<string, JsonValue> = { ...template };
  const metadataPattern = /^{{\s*trigger\.metadata\.([^.}]+(?:\.[^.}]+)*)\s*}}$/;
  for (const [key, value] of Object.entries(template)) {
    if (typeof value !== 'string') {
      continue;
    }
    const match = metadataPattern.exec(value.trim());
    if (!match) {
      continue;
    }
    const resolved = getMetadataValue(metadata, match[1]);
    if (resolved === null || resolved === undefined || resolved === '') {
      delete result[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildTriggerRequest(trigger: WorkflowProvisioningEventTrigger) {
  const parameterTemplate = pruneTriggerParameterTemplate(trigger.metadata, trigger.parameterTemplate);
  const predicates = trigger.predicates.length > 0 ? trigger.predicates : undefined;
  const metadataPayload = trigger.metadata ?? undefined;
  return compactRecord({
    name: trigger.name,
    description: trigger.description,
    eventType: trigger.eventType,
    eventSource: trigger.eventSource ?? undefined,
    predicates,
    parameterTemplate,
    metadata: metadataPayload,
    throttleWindowMs: trigger.throttleWindowMs,
    throttleCount: trigger.throttleCount,
    maxConcurrency: trigger.maxConcurrency,
    idempotencyKeyExpression: trigger.idempotencyKeyExpression,
    status: trigger.status
  });
}

function emptyScenarioState<TScenario extends ExampleScenario>(): WizardScenarioState<TScenario> {
  return { active: null, all: [] };
}

function updateScenarioState<TScenario extends ExampleScenario>(
  prev: WizardScenarioState<TScenario>,
  scenario: TScenario,
  token: number,
  setActive: boolean
): WizardScenarioState<TScenario> {
  const request: WizardScenarioRequest<TScenario> = { scenario, token };
  const filtered = prev.all.filter((entry) => entry.scenario.id !== scenario.id);
  const all = [...filtered, request];
  const shouldActivate = setActive || !prev.active || prev.active.scenario.id === scenario.id;
  const active = shouldActivate ? request : prev.active ?? request;
  return { active, all };
}

export function useImportWizardController() {
  const authorizedFetch = useAuthorizedFetch();
  const { trackEvent } = useAnalytics();
  const { pushToast } = useToasts();

  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ExampleScenario[]>([]);

  const [activeStep, setActiveStep] = useState<ImportWizardStep>(() => {
    if (typeof window === 'undefined') {
      return 'service-manifests';
    }
    const stored = window.localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (isImportWizardStep(stored)) {
      return stored;
    }
    return 'service-manifests';
  });

  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const scenarioTokenRef = useRef(0);
  const storedScenarios = useMemo(() => readStoredScenarios(), []);
  const pendingStoredScenarioIdsRef = useRef(storedScenarios);
  const [serviceScenarioState, setServiceScenarioState] = useState<WizardScenarioState<ServiceManifestScenario>>(() =>
    emptyScenarioState()
  );
  const [appScenarioState, setAppScenarioState] = useState<WizardScenarioState<AppScenario>>(() =>
    emptyScenarioState()
  );
  const [jobScenarioState, setJobScenarioState] = useState<WizardScenarioState<JobScenario>>(() =>
    emptyScenarioState()
  );
  const [workflowScenarioState, setWorkflowScenarioState] = useState<WizardScenarioState<WorkflowScenario>>(() =>
    emptyScenarioState()
  );
  const [autoImportState, setAutoImportState] = useState<AutoImportWizardState>({ status: 'idle', step: null, errors: [] });
  const [servicePlaceholderModal, setServicePlaceholderModal] = useState<ServicePlaceholderModalState | null>(null);
  const [serviceModalSubmitting, setServiceModalSubmitting] = useState(false);
  const [serviceModalError, setServiceModalError] = useState<string | null>(null);
  const autoImportedScenariosRef = useRef(new Set<string>());
  const scenarioById = useMemo(() => new Map(scenarios.map((entry) => [entry.id, entry])), [scenarios]);
  const [lastScenarioBundleId, setLastScenarioBundleId] = useState<string | null>(null);

  const getNextScenarioToken = useCallback(() => {
    scenarioTokenRef.current += 1;
    return Date.now() + scenarioTokenRef.current;
  }, []);

  useEffect(() => {
    if (scenarios.length === 0) {
      return;
    }
    const pending = pendingStoredScenarioIdsRef.current;
    if (!pending || Object.keys(pending).length === 0) {
      return;
    }

    const applyStoredScenario = <TScenario extends ExampleScenario>(
      step: ImportWizardStep,
      type: ExampleScenarioType,
      state: WizardScenarioState<TScenario>,
      setter: Dispatch<SetStateAction<WizardScenarioState<TScenario>>>
    ) => {
      const id = pending[step];
      if (!id || state.active) {
        return;
      }
      const candidate = scenarioById.get(id);
      if (!candidate || candidate.type !== type) {
        return;
      }
      setter((prev) => updateScenarioState(prev, candidate as TScenario, getNextScenarioToken(), true));
      delete pending[step];
    };

    applyStoredScenario('service-manifests', 'service-manifest', serviceScenarioState, setServiceScenarioState);
    applyStoredScenario('apps', 'app', appScenarioState, setAppScenarioState);
    applyStoredScenario('jobs', 'job', jobScenarioState, setJobScenarioState);
    applyStoredScenario('workflows', 'workflow', workflowScenarioState, setWorkflowScenarioState);

    if (Object.keys(pending).length === 0) {
      pendingStoredScenarioIdsRef.current = {};
    }
  }, [
    scenarios,
    scenarioById,
    getNextScenarioToken,
    serviceScenarioState,
    appScenarioState,
    jobScenarioState,
    workflowScenarioState
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setCatalogLoading(true);
      try {
        const response = await authorizedFetch(`${API_BASE_URL}/examples/catalog`);
        if (!response.ok) {
          throw new Error(`Failed to load example catalog (status ${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: { catalog?: { scenarios?: ExampleScenario[] } };
        };
        if (cancelled) {
          return;
        }
        const fetched = payload.data?.catalog?.scenarios ?? [];
        setScenarios(fetched);
        setCatalogError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load example catalog';
        setCatalogError(message);
        pushToast({
          tone: 'error',
          title: 'Failed to load examples',
          description: message
        });
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, pushToast]);

  useEffect(() => {
    window.localStorage.setItem(SUBTAB_STORAGE_KEY, activeStep);
  }, [activeStep]);

  useEffect(() => {
    if (!servicePlaceholderModal) {
      setServiceModalSubmitting(false);
      setServiceModalError(null);
    } else {
      setServiceModalError(null);
    }
  }, [servicePlaceholderModal]);

  useEffect(() => {
    const stored: StoredScenarioIds = {};
    if (serviceScenarioState.active) {
      stored['service-manifests'] = serviceScenarioState.active.scenario.id;
    }
    if (appScenarioState.active) {
      stored.apps = appScenarioState.active.scenario.id;
    }
    if (jobScenarioState.active) {
      stored.jobs = jobScenarioState.active.scenario.id;
    }
    if (workflowScenarioState.active) {
      stored.workflows = workflowScenarioState.active.scenario.id;
    }
    persistStoredScenarios(stored);
  }, [serviceScenarioState.active, appScenarioState.active, jobScenarioState.active, workflowScenarioState.active]);

  const setAutoImportRunning = useCallback((step: string) => {
    setAutoImportState({ status: 'running', step, errors: [] });
  }, []);

  const completeAutoImport = useCallback(
    (errors: string[]) => {
      if (errors.length === 0) {
        setAutoImportState({ status: 'success', step: null, errors: [] });
        pushToast({
          tone: 'success',
          title: 'Examples imported',
          description: 'All example assets are ready to use.'
        });
        return;
      }

      setAutoImportState({ status: 'error', step: null, errors });
      pushToast({
        tone: 'error',
        title: 'Example import incomplete',
        description: 'Some example assets failed to import. Review the details below.'
      });
    },
    [pushToast]
  );

  const attemptServiceImportScenario = useCallback(
    async (
      scenario: ServiceManifestScenario,
      overrides?: Record<string, string>
    ): Promise<
      | { kind: 'success' }
      | { kind: 'placeholders'; placeholders: ManifestPlaceholder[]; variables: Record<string, string> }
    > => {
      const overrideVariables =
        overrides !== undefined ? mergeServiceVariables(scenario.form.variables ?? {}, overrides) : undefined;
      const normalizedVariables = overrideVariables ? normalizeVariablesForRequest(overrideVariables) : undefined;

      const sourceType = scenario.form.sourceType === 'image' ? 'image' : 'git';
      const body: Record<string, unknown> = {
        requirePlaceholderValues: true
      };

      if (sourceType === 'git') {
        const repo = scenario.form.repo?.trim();
        if (!repo) {
          throw new Error(`Example service manifest ${scenario.id} is missing a repository`);
        }
        body.repo = repo;
        const ref = scenario.form.ref?.trim();
        if (ref) {
          body.ref = ref;
        }
        const commit = scenario.form.commit?.trim();
        if (commit) {
          body.commit = commit;
        }
      } else {
        const image = scenario.form.image?.trim();
        if (!image) {
          throw new Error(`Example service manifest ${scenario.id} is missing an image reference`);
        }
        body.image = image;
      }
      const configPath = scenario.form.configPath?.trim();
      if (configPath) {
        body.configPath = configPath;
      }
      const moduleValue = scenario.form.module?.trim();
      if (moduleValue) {
        body.module = moduleValue;
      }
      if (normalizedVariables) {
        body.variables = normalizedVariables;
      }

      const response = await authorizedFetch(`${API_BASE_URL}/service-networks/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (response.ok || response.status === 409) {
        return { kind: 'success' };
      }

      const payload = await response.json().catch(() => null);
      if (response.status === 400 && payload && Array.isArray(payload.placeholders)) {
        const placeholders = payload.placeholders as ManifestPlaceholder[];
        const baseVariables = mergeServiceVariables(scenario.form.variables ?? {}, overrides ?? {});
        const hydratedVariables = hydratePlaceholderVariables(placeholders, baseVariables);
        return { kind: 'placeholders', placeholders, variables: hydratedVariables };
      }

      const message =
        typeof payload?.error === 'string' ? payload.error : `Service manifest import failed (${response.status})`;
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
        tags: scenario.form.tags ?? [],
        metadataStrategy: scenario.form.metadataStrategy ?? 'auto'
      };
      const response = await authorizedFetch(`${API_BASE_URL}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok || response.status === 409) {
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
          throw new Error('Example bundle slug is required');
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

  const applyWorkflowProvisioning = useCallback(
    async (scenario: WorkflowScenario) => {
      const plan = resolveWorkflowProvisioningPlan(scenario.form);
      if (plan.schedules.length === 0 && plan.eventTriggers.length === 0) {
        return;
      }

      const workflowSlug = scenario.form.slug;

      const existingSchedules = new Map<string, { id: string }>();
      if (plan.schedules.length > 0) {
        const scheduleResponse = await authorizedFetch(`${API_BASE_URL}/workflow-schedules`, {
          method: 'GET'
        });
        if (!scheduleResponse.ok) {
          const payload = await scheduleResponse.json().catch(() => null);
          const message = typeof payload?.error === 'string'
            ? payload.error
            : `Failed to list workflow schedules (${scheduleResponse.status})`;
          throw new Error(message);
        }
        const schedulePayload = await scheduleResponse.json().catch(() => null);
        if (schedulePayload && Array.isArray(schedulePayload.data)) {
          for (const entry of schedulePayload.data as Array<{
            schedule?: { id: string; name: string | null };
            workflow?: { slug?: string | null };
          }>) {
            if (!entry?.schedule || entry?.workflow?.slug !== workflowSlug) {
              continue;
            }
            const key = entry.schedule.name ?? '__default__';
            existingSchedules.set(key, { id: entry.schedule.id });
          }
        }
      }

      const existingTriggers = new Map<string, { id: string }>();
      if (plan.eventTriggers.length > 0) {
        const triggerResponse = await authorizedFetch(`${API_BASE_URL}/workflows/${workflowSlug}/triggers`, {
          method: 'GET'
        });
        if (!triggerResponse.ok) {
          const payload = await triggerResponse.json().catch(() => null);
          const message = typeof payload?.error === 'string'
            ? payload.error
            : `Failed to list workflow triggers (${triggerResponse.status})`;
          throw new Error(message);
        }
        const triggerPayload = await triggerResponse.json().catch(() => null);
        const triggerEntries = triggerPayload?.data?.triggers;
        if (Array.isArray(triggerEntries)) {
          for (const entry of triggerEntries as Array<{ id: string; name: string | null }>) {
            const key = entry.name ?? '__default__';
            existingTriggers.set(key, { id: entry.id });
          }
        }
      }

      for (const schedule of plan.schedules) {
        const payload = buildScheduleRequest(schedule);
        const key = schedule.name ?? '__default__';
        const existing = existingSchedules.get(key);
        if (existing) {
          const response = await authorizedFetch(`${API_BASE_URL}/workflow-schedules/${existing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            const message = typeof body?.error === 'string'
              ? body.error
              : `Failed to update schedule (${response.status})`;
            throw new Error(message);
          }
        } else {
          const response = await authorizedFetch(`${API_BASE_URL}/workflows/${workflowSlug}/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok && response.status !== 409) {
            const body = await response.json().catch(() => null);
            const message = typeof body?.error === 'string'
              ? body.error
              : `Failed to create schedule (${response.status})`;
            throw new Error(message);
          }
        }
      }

      for (const trigger of plan.eventTriggers) {
        const key = trigger.name ?? '__default__';
        const payload = buildTriggerRequest(trigger);
        const existing = existingTriggers.get(key);
        if (existing) {
          const response = await authorizedFetch(
            `${API_BASE_URL}/workflows/${workflowSlug}/triggers/${existing.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }
          );
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            const message = typeof body?.error === 'string'
              ? body.error
              : `Failed to update trigger (${response.status})`;
            throw new Error(message);
          }
        } else {
          const response = await authorizedFetch(`${API_BASE_URL}/workflows/${workflowSlug}/triggers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok && response.status !== 409) {
            const body = await response.json().catch(() => null);
            const message = typeof body?.error === 'string'
              ? body.error
              : `Failed to create trigger (${response.status})`;
            throw new Error(message);
          }
        }
      }
    },
    [authorizedFetch]
  );

  const importWorkflowScenario = useCallback(
    async (scenario: WorkflowScenario) => {
      const response = await authorizedFetch(`${API_BASE_URL}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario.form)
      });
      if (response.ok || response.status === 409) {
        await applyWorkflowProvisioning(scenario);
        return;
      }
      const payload = await response.json().catch(() => null);
      const message = typeof payload?.error === 'string' ? payload.error : `Workflow import failed (${response.status})`;
      throw new Error(message);
    },
    [authorizedFetch, applyWorkflowProvisioning]
  );

  const processAutoImportQueue = useCallback(
    async (queue: ExampleImportQueue, errors: string[]) => {
      const totalItems =
        queue.service.length + queue.app.length + queue.job.length + queue.workflow.length;
      if (totalItems === 0) {
        completeAutoImport(errors);
        return;
      }

      let remainingQueue: ExampleImportQueue = {
        bundleId: queue.bundleId,
        service: [...queue.service],
        app: [...queue.app],
        job: [...queue.job],
        workflow: [...queue.workflow]
      };

      while (remainingQueue.service.length > 0) {
        const [scenario, ...rest] = remainingQueue.service;
        setAutoImportRunning('Importing service manifests');
        try {
          const result = await attemptServiceImportScenario(scenario);
          if (result.kind === 'placeholders') {
            setAutoImportRunning('Awaiting service placeholder values');
            setActiveStep('service-manifests');
            pushToast({
              tone: 'info',
              title: 'Service manifest placeholders required',
              description: `Provide values for ${scenario.title} to continue importing examples.`
            });
            setServicePlaceholderModal({
              scenario,
              placeholders: result.placeholders,
              variables: result.variables,
              queue: {
                bundleId: remainingQueue.bundleId,
                service: rest,
                app: remainingQueue.app,
                job: remainingQueue.job,
                workflow: remainingQueue.workflow
              },
              errors
            });
            return;
          }
        } catch (err) {
          errors.push(`${scenario.title}: ${(err as Error).message}`);
        }
        remainingQueue = {
          ...remainingQueue,
          service: rest
        };
      }

      if (remainingQueue.app.length > 0) {
        setAutoImportRunning('Registering example apps');
        for (const scenario of remainingQueue.app) {
          try {
            await importAppScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      if (remainingQueue.job.length > 0) {
        setAutoImportRunning('Uploading job bundles');
        for (const scenario of remainingQueue.job) {
          try {
            await importJobScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      if (remainingQueue.workflow.length > 0) {
        setAutoImportRunning('Creating workflows');
        for (const scenario of remainingQueue.workflow) {
          try {
            await importWorkflowScenario(scenario);
          } catch (err) {
            errors.push(`${scenario.title}: ${(err as Error).message}`);
          }
        }
      }

      completeAutoImport(errors);
    },
    [
      attemptServiceImportScenario,
      completeAutoImport,
      importAppScenario,
      importJobScenario,
      importWorkflowScenario,
      pushToast,
      setAutoImportRunning
    ]
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
        completeAutoImport([]);
        return;
      }

      const grouped = groupScenariosByType(scenarios);
      const queue: ExampleImportQueue = {
        bundleId,
        service: [...grouped['service-manifest']],
        app: [...grouped.app],
        job: [...grouped.job],
        workflow: [...grouped.workflow]
      };

      await processAutoImportQueue(queue, []);
    },
    [completeAutoImport, processAutoImportQueue, scenarioById]
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
        setActiveStep(scenario.focus ?? 'workflows');
        setScenarioPickerOpen(false);
        void autoImportIncludes(scenario.id, scenario.includes);
        return;
      }

      trackEvent('import_example_applied', {
        scenarioId: scenario.id,
        scenarioType: scenario.type,
        scenarioTag: scenario.analyticsTag ?? null
      });

      const targetStep = SUBTAB_FOR_SCENARIO[scenario.type];
      const focusStep = targetStep ?? 'workflows';
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
      setActiveStep(focusStep);
      setScenarioPickerOpen(false);
      if (relatedIds.length > 0) {
        void autoImportIncludes(scenario.id, relatedIds);
      }
    },
    [applyAppScenario, applyJobScenario, applyServiceScenario, applyWorkflowScenario, autoImportIncludes, scenarioById, trackEvent]
  );

  const handleScenarioCleared = useCallback(
    (step: ImportWizardStep) => {
      const scenarioType = SCENARIO_TYPE_FOR_STEP[step];
      const currentScenario =
        step === 'service-manifests'
          ? serviceScenarioState.active?.scenario
          : step === 'apps'
            ? appScenarioState.active?.scenario
            : step === 'jobs'
              ? jobScenarioState.active?.scenario
              : workflowScenarioState.active?.scenario;
      if (currentScenario) {
        trackEvent('import_example_cleared', {
          scenarioId: currentScenario.id,
          scenarioType,
          scenarioTag: currentScenario.analyticsTag ?? null
        });
      }
      if (step === 'service-manifests') {
        setServiceScenarioState(emptyScenarioState());
      } else if (step === 'apps') {
        setAppScenarioState(emptyScenarioState());
      } else if (step === 'jobs') {
        setJobScenarioState(emptyScenarioState());
      } else if (step === 'workflows') {
        setWorkflowScenarioState(emptyScenarioState());
      }
    },
    [serviceScenarioState.active, appScenarioState.active, jobScenarioState.active, workflowScenarioState.active, trackEvent]
  );

  const handleScenarioSelected = useCallback(
    (step: ImportWizardStep, scenarioId: string) => {
      const token = getNextScenarioToken();
      if (step === 'service-manifests') {
        const existing = serviceScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setServiceScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = scenarioById.get(scenarioId);
        if (fallback && fallback.type === 'service-manifest') {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setServiceScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
        return;
      }
      if (step === 'apps') {
        const existing = appScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setAppScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = scenarioById.get(scenarioId);
        if (fallback && fallback.type === 'app') {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setAppScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
        return;
      }
      if (step === 'jobs') {
        const existing = jobScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setJobScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = scenarioById.get(scenarioId);
        if (fallback && fallback.type === 'job') {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setJobScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
        return;
      }
      if (step === 'workflows') {
        const existing = workflowScenarioState.all.find((entry) => entry.scenario.id === scenarioId);
        if (existing) {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setWorkflowScenarioState((prev) => updateScenarioState(prev, existing.scenario, token, true));
          return;
        }
        const fallback = scenarioById.get(scenarioId);
        if (fallback && fallback.type === 'workflow') {
          trackEvent('import_example_switched', { subtab: step, scenarioId });
          setWorkflowScenarioState((prev) => updateScenarioState(prev, fallback, token, true));
        }
      }
    },
    [appScenarioState.all, getNextScenarioToken, jobScenarioState.all, serviceScenarioState.all, trackEvent, workflowScenarioState.all]
  );

  const handleOpenPicker = useCallback(() => {
    trackEvent('import_example_picker_opened');
    setScenarioPickerOpen(true);
  }, [trackEvent]);

  const handleClosePicker = useCallback(() => {
    setScenarioPickerOpen(false);
  }, []);

  const handleLoadAllExamples = useCallback(() => {
    const loadAllScenario = scenarios.find(
      (entry) => entry.type === 'scenario' && entry.analyticsTag === 'bundle__all_examples'
    );
    if (loadAllScenario) {
      handleApplyScenario(loadAllScenario);
    }
  }, [handleApplyScenario, scenarios]);

  const scenarioOptions = useMemo(() => {
    return {
      service: serviceScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
      app: appScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
      job: jobScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title })),
      workflow: workflowScenarioState.all.map((entry) => ({ id: entry.scenario.id, title: entry.scenario.title }))
    } as const;
  }, [serviceScenarioState.all, appScenarioState.all, jobScenarioState.all, workflowScenarioState.all]);

  const activeScenarioIds = useMemo(
    () => ({
      'service-manifest': serviceScenarioState.active?.scenario.id ?? null,
      app: appScenarioState.active?.scenario.id ?? null,
      job: jobScenarioState.active?.scenario.id ?? null,
      workflow: workflowScenarioState.active?.scenario.id ?? null,
      scenario: lastScenarioBundleId
    }),
    [appScenarioState.active, jobScenarioState.active, lastScenarioBundleId, serviceScenarioState.active, workflowScenarioState.active]
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

  const handleServiceModalVariableChange = useCallback((name: string, value: string) => {
    setServicePlaceholderModal((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        variables: {
          ...prev.variables,
          [name]: value
        }
      };
    });
  }, []);

  const handleServiceModalSubmit = useCallback(async () => {
    if (!servicePlaceholderModal) {
      return;
    }
    const modalState = servicePlaceholderModal;
    setServiceModalSubmitting(true);
    setServiceModalError(null);
    try {
      const result = await attemptServiceImportScenario(modalState.scenario, modalState.variables);
      if (result.kind === 'placeholders') {
        setServicePlaceholderModal((prev) =>
          prev
            ? {
                ...prev,
                placeholders: result.placeholders,
                variables: result.variables
              }
            : prev
        );
        return;
      }

      setServicePlaceholderModal(null);
      await processAutoImportQueue(modalState.queue, modalState.errors);
    } catch (err) {
      setServiceModalError((err as Error).message);
    } finally {
      setServiceModalSubmitting(false);
    }
  }, [attemptServiceImportScenario, processAutoImportQueue, servicePlaceholderModal]);

  const handleServiceModalCancel = useCallback(() => {
    setServicePlaceholderModal(null);
    setAutoImportState({ status: 'idle', step: null, errors: [] });
  }, []);

  return {
    catalogLoading,
    catalogError,
    scenarios,
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
    activeScenarioIds,
    loadedScenarioCounts,
    autoImportState,
    servicePlaceholderModal,
    serviceModalSubmitting,
    serviceModalError,
    handleServiceModalVariableChange,
    handleServiceModalSubmit,
    handleServiceModalCancel,
    applyServiceScenario,
    applyAppScenario,
    applyJobScenario,
    applyWorkflowScenario
  } as const;
}
