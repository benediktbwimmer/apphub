import Ajv, { type ValidateFunction } from 'ajv';
import { toRecord } from '../normalizers';
import type {
  WorkflowDefinition,
  WorkflowDefinitionStep,
  WorkflowDraft,
  WorkflowDraftStep,
  WorkflowDraftStepType
} from '../types';
import type {
  JobDefinitionSummary,
  WorkflowCreateInput,
  WorkflowServiceRequestInput,
  WorkflowStepInput,
  WorkflowUpdateInput
} from '../api';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false, strictTuples: false });
const schemaCache = new Map<string, ValidateFunction | null>();

type WorkflowSecretHeader = {
  secret: { source: 'env' | 'store'; key: string; prefix?: string };
};

type WorkflowRequestHeaders = Record<string, string | WorkflowSecretHeader>;

type WorkflowRequestQuery = Record<string, string | number | boolean>;

export type DraftValidationIssue = {
  path: string;
  message: string;
};

export type DraftValidation = {
  valid: boolean;
  errors: DraftValidationIssue[];
  stepErrors: Record<string, DraftValidationIssue[]>;
};

export type DiffEntry = {
  path: string;
  change: 'added' | 'removed' | 'updated';
  before?: unknown;
  after?: unknown;
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function parseTags(metadata: unknown): string[] {
  const record = toRecord(metadata);
  if (!record) {
    return [];
  }
  const raw = record.tags;
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? entry : null))
      .filter((entry): entry is string => Boolean(entry))
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function parseOwnerName(metadata: unknown): string {
  const record = toRecord(metadata);
  if (!record) {
    return '';
  }
  const owner = toRecord(record.owner);
  if (owner && typeof owner.name === 'string' && owner.name.trim().length > 0) {
    return owner.name.trim();
  }
  if (typeof record.ownerName === 'string' && record.ownerName.trim().length > 0) {
    return record.ownerName.trim();
  }
  return '';
}

function parseOwnerContact(metadata: unknown): string {
  const record = toRecord(metadata);
  if (!record) {
    return '';
  }
  const owner = toRecord(record.owner);
  if (owner && typeof owner.contact === 'string' && owner.contact.trim().length > 0) {
    return owner.contact.trim();
  }
  if (typeof record.ownerContact === 'string' && record.ownerContact.trim().length > 0) {
    return record.ownerContact.trim();
  }
  if (typeof record.contact === 'string' && record.contact.trim().length > 0) {
    return record.contact.trim();
  }
  return '';
}

function parseVersionNote(metadata: unknown): string {
  const record = toRecord(metadata);
  if (!record) {
    return '';
  }
  const note = record.versionNote;
  if (typeof note === 'string') {
    return note;
  }
  return '';
}

function cloneParameters(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function ensureArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
}

function stepTypeFromDefinition(step: WorkflowDefinitionStep): WorkflowDraftStepType {
  if (step.type === 'service') {
    return 'service';
  }
  if (step.serviceSlug) {
    return 'service';
  }
  return 'job';
}

function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function definitionStepToDraft(step: WorkflowDefinitionStep): WorkflowDraftStep {
  const type = stepTypeFromDefinition(step);
  const dependsOn = ensureArray(step.dependsOn);
  const request = toRecord(step.request);
  const parameters = 'parameters' in step ? step.parameters : undefined;
  const requestBody = request?.body ?? undefined;
  return {
    id: step.id,
    name: step.name,
    type,
    jobSlug: step.jobSlug,
    serviceSlug: step.serviceSlug,
    description: step.description ?? null,
    dependsOn,
    parameters: cloneParameters(parameters) ?? (type === 'job' ? {} : {}),
    timeoutMs: typeof step.timeoutMs === 'number' || step.timeoutMs === null ? step.timeoutMs : null,
    retryPolicy: step.retryPolicy ?? null,
    storeResultAs: step.storeResultAs,
    requireHealthy: step.requireHealthy,
    allowDegraded: step.allowDegraded,
    captureResponse: step.captureResponse,
    storeResponseAs: step.storeResponseAs,
    request: request ?? (type === 'service' ? { path: '/', method: 'GET' } : undefined),
    parametersText: stringifyJson(parameters ?? {}),
    requestBodyText: type === 'service' ? stringifyJson(requestBody ?? null) : undefined
  } satisfies WorkflowDraftStep;
}

export function workflowDefinitionToDraft(workflow: WorkflowDefinition): WorkflowDraft {
  const tags = parseTags(workflow.metadata);
  const ownerName = parseOwnerName(workflow.metadata);
  const ownerContact = parseOwnerContact(workflow.metadata);
  const versionNote = parseVersionNote(workflow.metadata);

  const draft: WorkflowDraft = {
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description ?? null,
    ownerName,
    ownerContact,
    tags,
    tagsInput: tags.join(', '),
    version: workflow.version ?? 1,
    versionNote,
    steps: workflow.steps.map((step) => definitionStepToDraft(step)),
    triggers: workflow.triggers.length > 0 ? workflow.triggers : [{ type: 'manual' }],
    parametersSchema: toRecord(workflow.parametersSchema) ?? null,
    defaultParameters: cloneParameters(workflow.defaultParameters) ?? {},
    metadata: (workflow.metadata as Record<string, unknown>) ?? null,
    parametersSchemaText: stringifyJson(workflow.parametersSchema ?? {}),
    parametersSchemaError: null,
    defaultParametersText: stringifyJson(workflow.defaultParameters ?? {}),
    defaultParametersError: null
  };

  return draft;
}

export function createEmptyDraft(): WorkflowDraft {
  return {
    slug: '',
    name: '',
    description: '',
    ownerName: '',
    ownerContact: '',
    tags: [],
    tagsInput: '',
    version: 1,
    versionNote: '',
    steps: [],
    triggers: [{ type: 'manual' }],
    parametersSchema: {},
    defaultParameters: {},
    metadata: null,
    parametersSchemaText: '{}\n',
    parametersSchemaError: null,
    defaultParametersText: '{}\n',
    defaultParametersError: null
  };
}

function normalizeDependsOn(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !unique.has(trimmed)) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}

function sanitizeJobSlug(slug: string | undefined): string | undefined {
  if (typeof slug !== 'string') {
    return undefined;
  }
  const trimmed = slug.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeServiceSlug(slug: string | undefined): string | undefined {
  if (typeof slug !== 'string') {
    return undefined;
  }
  const trimmed = slug.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeHeaderSecret(value: unknown): WorkflowSecretHeader | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const secret = toRecord(record.secret);
  if (!secret) {
    return null;
  }
  const source = secret.source;
  if (source !== 'env' && source !== 'store') {
    return null;
  }
  const key = typeof secret.key === 'string' ? secret.key.trim() : '';
  if (!key) {
    return null;
  }
  const prefix = typeof secret.prefix === 'string' ? secret.prefix : undefined;
  const sanitized: WorkflowSecretHeader = {
    secret: {
      source,
      key
    }
  };
  if (prefix) {
    sanitized.secret.prefix = prefix;
  }
  return sanitized;
}

function sanitizeRequestHeaders(value: unknown): WorkflowRequestHeaders | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const sanitized: WorkflowRequestHeaders = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string') {
      sanitized[key] = raw;
      continue;
    }
    const secret = sanitizeHeaderSecret(raw);
    if (secret) {
      sanitized[key] = secret;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeRequestQuery(value: unknown): WorkflowRequestQuery | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const sanitized: WorkflowRequestQuery = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      sanitized[key] = raw;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeRequest(step: WorkflowDraftStep): WorkflowServiceRequestInput | undefined {
  if (step.type !== 'service') {
    return undefined;
  }
  const raw = toRecord(step.request);
  const path = typeof raw?.path === 'string' && raw.path.trim().length > 0 ? raw.path.trim() : '/';
  const methodRaw = typeof raw?.method === 'string' ? raw.method.toUpperCase() : 'GET';
  const method: WorkflowServiceRequestInput['method'] =
    methodRaw === 'POST' ||
    methodRaw === 'PUT' ||
    methodRaw === 'PATCH' ||
    methodRaw === 'DELETE' ||
    methodRaw === 'HEAD'
      ? methodRaw
      : 'GET';
  const headers = sanitizeRequestHeaders(raw?.headers);
  const query = sanitizeRequestQuery(raw?.query);
  const body = 'body' in (raw ?? {}) ? raw?.body : undefined;
  return {
    path,
    method,
    headers,
    query,
    body
  } satisfies WorkflowServiceRequestInput;
}

function sanitizeParameters(step: WorkflowDraftStep): unknown {
  if (step.parameters === undefined) {
    return undefined;
  }
  return step.parameters;
}

function sanitizeStep(step: WorkflowDraftStep): WorkflowStepInput {
  const dependsOn = normalizeDependsOn(step.dependsOn ?? []);
  if (step.type === 'service') {
    return {
      id: step.id,
      name: step.name,
      type: 'service',
      serviceSlug: sanitizeServiceSlug(step.serviceSlug) ?? '',
      description: step.description ?? undefined,
      dependsOn,
      parameters: sanitizeParameters(step),
      timeoutMs: step.timeoutMs ?? undefined,
      retryPolicy: step.retryPolicy ?? undefined,
      requireHealthy: step.requireHealthy ?? undefined,
      allowDegraded: step.allowDegraded ?? undefined,
      captureResponse: step.captureResponse ?? undefined,
      storeResponseAs: step.storeResponseAs ?? undefined,
      request: sanitizeRequest(step) ?? { path: '/', method: 'GET' }
    } satisfies WorkflowStepInput;
  }

  const jobSlug = sanitizeJobSlug(step.jobSlug) ?? '';

  const payload = {
    id: step.id,
    name: step.name,
    jobSlug,
    description: step.description ?? undefined,
    dependsOn,
    parameters: sanitizeParameters(step),
    timeoutMs: step.timeoutMs ?? undefined,
    retryPolicy: step.retryPolicy ?? undefined,
    storeResultAs: step.storeResultAs ?? undefined
  } satisfies WorkflowStepInput;

  return payload;
}

function buildMetadata(draft: WorkflowDraft): Record<string, unknown> | null {
  const base = draft.metadata ? { ...draft.metadata } : {};
  const owner: Record<string, unknown> = {};
  if (draft.ownerName) {
    owner.name = draft.ownerName;
  }
  if (draft.ownerContact) {
    owner.contact = draft.ownerContact;
  }
  if (Object.keys(owner).length > 0) {
    base.owner = owner;
  } else if ('owner' in base) {
    delete base.owner;
  }
  if (draft.ownerName) {
    base.ownerName = draft.ownerName;
  } else {
    delete base.ownerName;
  }
  if (draft.ownerContact) {
    base.ownerContact = draft.ownerContact;
  } else {
    delete base.ownerContact;
  }
  if (draft.tags.length > 0) {
    base.tags = draft.tags;
  } else {
    delete base.tags;
  }
  if (draft.versionNote) {
    base.versionNote = draft.versionNote;
  } else {
    delete base.versionNote;
  }
  return Object.keys(base).length > 0 ? base : null;
}

export function draftToCreateInput(draft: WorkflowDraft): WorkflowCreateInput {
  return {
    slug: draft.slug.trim(),
    name: draft.name.trim(),
    version: draft.version ?? 1,
    description: draft.description ?? undefined,
    steps: draft.steps.map((step) => sanitizeStep(step)),
    triggers: draft.triggers.length > 0 ? draft.triggers : [{ type: 'manual' }],
    parametersSchema: draft.parametersSchema ?? undefined,
    defaultParameters: draft.defaultParameters ?? undefined,
    metadata: buildMetadata(draft) ?? undefined
  } satisfies WorkflowCreateInput;
}

export function draftToUpdateInput(
  draft: WorkflowDraft,
  original: WorkflowDefinition | null
): WorkflowUpdateInput {
  const payload = draftToCreateInput(draft);
  if (!original) {
    return payload;
  }
  const baseline = draftToCreateInput(workflowDefinitionToDraft(original));
  const update: WorkflowUpdateInput = {};
  if (!isEqual(payload.name, baseline.name)) {
    update.name = payload.name;
  }
  if (!isEqual(payload.version, baseline.version)) {
    update.version = payload.version;
  }
  if (!isEqual(payload.description, baseline.description)) {
    update.description = payload.description ?? null;
  }
  if (!isEqual(payload.steps, baseline.steps)) {
    update.steps = payload.steps;
  }
  if (!isEqual(payload.triggers, baseline.triggers)) {
    update.triggers = payload.triggers;
  }
  if (!isEqual(payload.parametersSchema, baseline.parametersSchema)) {
    update.parametersSchema = payload.parametersSchema ?? {};
  }
  if (!isEqual(payload.defaultParameters, baseline.defaultParameters)) {
    update.defaultParameters = payload.defaultParameters ?? null;
  }
  if (!isEqual(payload.metadata, baseline.metadata)) {
    update.metadata = payload.metadata ?? null;
  }
  return update;
}

function getSchemaValidator(schema: unknown, cacheKey: string): ValidateFunction | null {
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey) ?? null;
  }
  try {
    const validator = ajv.compile(schema as Record<string, unknown>);
    schemaCache.set(cacheKey, validator);
    return validator;
  } catch {
    schemaCache.set(cacheKey, null);
    return null;
  }
}

export function validateWorkflowDraft(
  draft: WorkflowDraft,
  jobs: JobDefinitionSummary[]
): DraftValidation {
  const errors: DraftValidationIssue[] = [];
  const stepErrors: Record<string, DraftValidationIssue[]> = {};

  const slug = draft.slug.trim();
  if (!slug) {
    errors.push({ path: 'slug', message: 'Slug is required.' });
  } else if (!SLUG_PATTERN.test(slug)) {
    errors.push({ path: 'slug', message: 'Slug may only contain alphanumeric characters, dashes, or underscores.' });
  }

  if (!draft.name.trim()) {
    errors.push({ path: 'name', message: 'Workflow name is required.' });
  }

  if (!draft.ownerContact.trim()) {
    errors.push({ path: 'ownerContact', message: 'Owner contact is required.' });
  }

  if (draft.steps.length === 0) {
    errors.push({ path: 'steps', message: 'Add at least one step to the workflow.' });
  }

  const seenStepIds = new Set<string>();
  const jobBySlug = new Map<string, JobDefinitionSummary>();
  for (const job of jobs) {
    jobBySlug.set(job.slug, job);
  }

  for (const step of draft.steps) {
    const list: DraftValidationIssue[] = [];
    stepErrors[step.id] = list;
    const trimmedId = step.id.trim();
    if (!trimmedId) {
      list.push({ path: `${step.id}.id`, message: 'Step ID is required.' });
    } else if (seenStepIds.has(trimmedId)) {
      list.push({ path: `${step.id}.id`, message: 'Step IDs must be unique.' });
    } else {
      seenStepIds.add(trimmedId);
    }

    if (!step.name.trim()) {
      list.push({ path: `${step.id}.name`, message: 'Step name is required.' });
    }

    const dependsOn = normalizeDependsOn(step.dependsOn ?? []);
    for (const dep of dependsOn) {
      if (dep === step.id) {
        list.push({ path: `${step.id}.dependsOn`, message: 'Steps cannot depend on themselves.' });
        break;
      }
    }

    if (step.type === 'service') {
      if (!sanitizeServiceSlug(step.serviceSlug)) {
        list.push({ path: `${step.id}.serviceSlug`, message: 'Select a service for this step.' });
      }
      const request = sanitizeRequest(step);
      if (!request?.path || request.path === '/') {
        list.push({ path: `${step.id}.request.path`, message: 'Provide a request path for the service step.' });
      }
      if (step.requestBodyError) {
        list.push({ path: `${step.id}.request.body`, message: step.requestBodyError });
      }
    } else {
      const jobSlug = sanitizeJobSlug(step.jobSlug);
      if (!jobSlug) {
        list.push({ path: `${step.id}.jobSlug`, message: 'Select a job definition for this step.' });
      } else if (!jobBySlug.has(jobSlug)) {
        list.push({ path: `${step.id}.jobSlug`, message: 'Unknown job definition selected.' });
      } else {
        const job = jobBySlug.get(jobSlug);
        if (job?.parametersSchema && step.parametersError == null) {
          const cacheKey = `${job.slug}:${stableStringify(job.parametersSchema)}`;
          const validator = getSchemaValidator(job.parametersSchema, cacheKey);
          if (validator) {
            const valid = validator(step.parameters ?? {});
            if (!valid) {
              const firstError = validator.errors?.[0]?.message || 'Parameters do not match the job schema.';
              list.push({ path: `${step.id}.parameters`, message: firstError });
            }
          }
        }
      }
    }

    if (step.parametersError) {
      list.push({ path: `${step.id}.parameters`, message: step.parametersError });
    }

    if (list.length === 0) {
      delete stepErrors[step.id];
    }
  }

  if (draft.parametersSchemaError) {
    errors.push({ path: 'parametersSchema', message: draft.parametersSchemaError });
  }

  if (draft.defaultParametersError) {
    errors.push({ path: 'defaultParameters', message: draft.defaultParametersError });
  }

  const valid = errors.length === 0 && Object.keys(stepErrors).length === 0;
  return { valid, errors, stepErrors };
}

export function computeDraftDiff(
  original: WorkflowDefinition | null,
  draft: WorkflowDraft
): DiffEntry[] {
  if (!original) {
    return [];
  }
  const baselineSpec = draftToCreateInput(workflowDefinitionToDraft(original));
  const currentSpec = draftToCreateInput(draft);
  const entries: DiffEntry[] = [];

  const fields: Array<keyof WorkflowCreateInput> = [
    'name',
    'version',
    'description',
    'steps',
    'triggers',
    'parametersSchema',
    'defaultParameters',
    'metadata'
  ];

  for (const field of fields) {
    if (!isEqual(currentSpec[field], baselineSpec[field])) {
      entries.push({ path: field, change: 'updated', before: baselineSpec[field], after: currentSpec[field] });
    }
  }

  return entries;
}

const STORAGE_VERSION = 1;

export function buildAutosavePayload(draft: WorkflowDraft, mode: 'create' | 'edit') {
  return {
    version: STORAGE_VERSION,
    mode,
    savedAt: new Date().toISOString(),
    draft
  };
}

export function loadDraftFromStorage(key: string): WorkflowDraft | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as { version?: number; draft?: WorkflowDraft };
    if (payload.version !== STORAGE_VERSION || !payload.draft) {
      return null;
    }
    return payload.draft;
  } catch {
    return null;
  }
}

export function saveDraftToStorage(key: string, mode: 'create' | 'edit', draft: WorkflowDraft): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const payload = buildAutosavePayload(draft, mode);
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function clearDraftFromStorage(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
