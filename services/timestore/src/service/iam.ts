import type { FastifyRequest } from 'fastify';
import { getDatasetBySlug, type DatasetRecord } from '../db/metadata';

const REQUIRED_SCOPE = process.env.TIMESTORE_REQUIRE_SCOPE;
const ADMIN_SCOPE = process.env.TIMESTORE_ADMIN_SCOPE || REQUIRED_SCOPE;
const WRITE_SCOPE_ENV = process.env.TIMESTORE_REQUIRE_WRITE_SCOPE;
const WRITE_SCOPE = WRITE_SCOPE_ENV || ADMIN_SCOPE || REQUIRED_SCOPE || null;
const METRICS_SCOPE = process.env.TIMESTORE_METRICS_SCOPE || ADMIN_SCOPE || REQUIRED_SCOPE || null;
const SQL_READ_SCOPES =
  parseScopeList(process.env.TIMESTORE_SQL_READ_SCOPE) ?? (REQUIRED_SCOPE ? [REQUIRED_SCOPE] : null);
const SQL_EXEC_SCOPES =
  parseScopeList(process.env.TIMESTORE_SQL_EXEC_SCOPE) ?? (ADMIN_SCOPE ? [ADMIN_SCOPE] : null);

export interface RequestActor {
  id: string;
  scopes: string[];
}

export async function authorizeAdminAccess(request: FastifyRequest): Promise<void> {
  const scopes = getRequestScopes(request);
  if (!ADMIN_SCOPE) {
    return;
  }
  if (!hasRequiredScope(scopes, [ADMIN_SCOPE])) {
    const message = `Missing required admin scope ${ADMIN_SCOPE}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

export function authorizeSqlReadAccess(request: FastifyRequest): void {
  enforceScopes(request, SQL_READ_SCOPES, 'Missing required SQL read scope');
}

export function authorizeSqlExecAccess(request: FastifyRequest): void {
  enforceScopes(request, SQL_EXEC_SCOPES, 'Missing required SQL exec scope');
}

export async function authorizeMetricsAccess(
  request: FastifyRequest,
  overrideScope: string | null = null
): Promise<void> {
  const requiredScope = overrideScope ?? METRICS_SCOPE;
  if (!requiredScope) {
    return;
  }
  const scopes = getRequestScopes(request);
  if (!hasRequiredScope(scopes, [requiredScope])) {
    const message = `Missing required metrics scope ${requiredScope}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

export async function loadDatasetForRead(request: FastifyRequest, datasetSlug: string): Promise<DatasetRecord> {
  const dataset = await getDatasetBySlug(datasetSlug);
  if (!dataset) {
    const error = new Error(`Dataset ${datasetSlug} not found`);
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
  assertDatasetReadAccess(request, dataset);
  return dataset;
}

export async function loadDatasetForWrite(
  request: FastifyRequest,
  datasetSlug: string
): Promise<DatasetRecord | null> {
  const dataset = await getDatasetBySlug(datasetSlug);
  assertDatasetWriteAccess(request, dataset);
  return dataset;
}

export function assertDatasetReadAccess(request: FastifyRequest, dataset: DatasetRecord): void {
  const requestScopes = getRequestScopes(request);
  const policyScopes = getDatasetReadScopes(dataset);
  const fallback = REQUIRED_SCOPE ? [REQUIRED_SCOPE] : [];
  const required = policyScopes ?? fallback;
  if (required.length === 0) {
    return;
  }
  if (!hasRequiredScope(requestScopes, required)) {
    const message = `Missing required scope for dataset ${dataset.slug}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

export function assertDatasetWriteAccess(
  request: FastifyRequest,
  dataset: DatasetRecord | null
): void {
  const requestScopes = getRequestScopes(request);
  const policyScopes = dataset ? getDatasetWriteScopes(dataset) : null;
  const fallback = WRITE_SCOPE ? [WRITE_SCOPE] : [];
  const required = policyScopes ?? fallback;
  if (required.length === 0) {
    return;
  }
  if (!hasRequiredScope(requestScopes, required)) {
    const message = dataset
      ? `Missing required write scope for dataset ${dataset.slug}`
      : 'Missing required scope to create dataset';
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

export function getRequestScopes(request: FastifyRequest): string[] {
  const scopeHeader = request.headers['x-iam-scopes'];
  if (typeof scopeHeader === 'string') {
    return scopeHeader
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }
  return [];
}

export function getRequestActorId(request: FastifyRequest): string | null {
  const possible = [request.headers['x-iam-user'], request.headers['x-user-id'], request.headers['x-actor-id']];
  for (const value of possible) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function resolveRequestActor(request: FastifyRequest): RequestActor | undefined {
  const id = getRequestActorId(request);
  if (!id) {
    return undefined;
  }
  const scopes = getRequestScopes(request);
  return {
    id,
    scopes
  };
}

function getDatasetReadScopes(dataset: DatasetRecord): string[] | null {
  const config = getDatasetIamConfig(dataset);
  return config.readScopes ?? null;
}

function getDatasetWriteScopes(dataset: DatasetRecord): string[] | null {
  const config = getDatasetIamConfig(dataset);
  return config.writeScopes ?? null;
}

function getDatasetIamConfig(dataset: DatasetRecord | null): {
  readScopes?: string[];
  writeScopes?: string[];
} {
  if (!dataset || !dataset.metadata || typeof dataset.metadata !== 'object') {
    return {};
  }
  const candidate = (dataset.metadata as Record<string, unknown>).iam;
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }
  const readScopes = asStringArray((candidate as Record<string, unknown>).readScopes);
  const writeScopes = asStringArray((candidate as Record<string, unknown>).writeScopes);
  return {
    readScopes: readScopes ?? undefined,
    writeScopes: writeScopes ?? undefined
  };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return result.length > 0 ? result : [];
}

function parseScopeList(value: string | undefined): string[] | null {
  if (!value) {
    return null;
  }
  const parts = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : null;
}

function hasRequiredScope(scopes: string[], required: string[]): boolean {
  return required.some((scope) => scopes.includes(scope));
}

function enforceScopes(request: FastifyRequest, required: string[] | null, errorMessage: string): void {
  if (!required || required.length === 0) {
    return;
  }
  const scopes = getRequestScopes(request);
  if (!hasRequiredScope(scopes, required)) {
    const error = new Error(errorMessage);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}
