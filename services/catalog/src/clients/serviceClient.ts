import { listServices, type JsonValue, type ServiceKind, type ServiceRecord, type ServiceStatus } from '../db';

const SERVICE_CLIENT_TIMEOUT_MS = Number(process.env.SERVICE_CLIENT_TIMEOUT_MS ?? 5_000);

const STATUS_PRIORITY: Record<ServiceStatus, number> = {
  healthy: 0,
  degraded: 1,
  unknown: 2,
  unreachable: 3
};

type RuntimeMetadataSnapshot = {
  baseUrl?: string | null;
  instanceUrl?: string | null;
  previewUrl?: string | null;
  host?: string | null;
  port?: number | null;
  status?: string | null;
  updatedAt?: string | null;
};

export type ServiceMetadataSnapshot = {
  manifest?: Record<string, unknown>;
  config?: Record<string, unknown>;
  runtime?: RuntimeMetadataSnapshot;
  raw?: Record<string, unknown> | null;
};

export type ResolvedService = {
  record: ServiceRecord;
  metadata: ServiceMetadataSnapshot;
};

export class ServiceUnavailableError extends Error {
  constructor(public readonly kind: ServiceKind, public readonly reason: 'missing' | 'unhealthy') {
    super(
      reason === 'missing'
        ? `No service registered for kind "${kind}"`
        : `No healthy service available for kind "${kind}"`
    );
    this.name = 'ServiceUnavailableError';
  }
}

function parseJsonObject(value: JsonValue | null): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return null;
}

function parseRuntimeMetadata(raw: unknown): RuntimeMetadataSnapshot | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const runtime: RuntimeMetadataSnapshot = {};

  if (typeof value.baseUrl === 'string') {
    runtime.baseUrl = value.baseUrl;
  }
  if (typeof value.instanceUrl === 'string') {
    runtime.instanceUrl = value.instanceUrl;
  }
  if (typeof value.previewUrl === 'string') {
    runtime.previewUrl = value.previewUrl;
  }
  if (typeof value.host === 'string') {
    runtime.host = value.host;
  }
  if (typeof value.port === 'number' && Number.isFinite(value.port)) {
    runtime.port = value.port;
  }
  if (typeof value.status === 'string') {
    runtime.status = value.status;
  }
  if (typeof value.updatedAt === 'string') {
    runtime.updatedAt = value.updatedAt;
  }

  return Object.keys(runtime).length > 0 ? runtime : undefined;
}

function parseMetadata(record: ServiceRecord): ServiceMetadataSnapshot {
  const raw = parseJsonObject(record.metadata ?? null);
  const manifest = raw?.manifest && typeof raw.manifest === 'object' && !Array.isArray(raw.manifest)
    ? { ...(raw.manifest as Record<string, unknown>) }
    : undefined;
  const config = raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
    ? { ...(raw.config as Record<string, unknown>) }
    : undefined;
  const runtime = raw?.runtime ? parseRuntimeMetadata(raw.runtime) : undefined;
  return {
    manifest,
    config,
    runtime,
    raw
  };
}

function compareServices(a: ServiceRecord, b: ServiceRecord) {
  const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (byStatus !== 0) {
    return byStatus;
  }
  const aUpdated = Date.parse(a.updatedAt);
  const bUpdated = Date.parse(b.updatedAt);
  if (Number.isFinite(aUpdated) && Number.isFinite(bUpdated)) {
    return bUpdated - aUpdated;
  }
  return 0;
}

export async function getResolvedService(
  kind: ServiceKind,
  options?: { requireHealthy?: boolean }
): Promise<ResolvedService | null> {
  const requireHealthy = options?.requireHealthy ?? false;
  const services = await listServices();
  const candidates = services.filter((service) => service.kind === kind).sort(compareServices);

  if (candidates.length === 0) {
    return null;
  }

  const preferred = requireHealthy
    ? candidates.find((candidate) => candidate.status === 'healthy') ?? null
    : candidates[0];

  if (!preferred || (requireHealthy && preferred.status !== 'healthy')) {
    return null;
  }

  return {
    record: preferred,
    metadata: parseMetadata(preferred)
  };
}

export async function requireResolvedService(
  kind: ServiceKind,
  options?: { requireHealthy?: boolean }
): Promise<ResolvedService> {
  const resolved = await getResolvedService(kind, options);
  if (!resolved) {
    const reason: 'missing' | 'unhealthy' = options?.requireHealthy ? 'unhealthy' : 'missing';
    throw new ServiceUnavailableError(kind, reason);
  }
  return resolved;
}

function maybeUnref(timer: ReturnType<typeof setTimeout>) {
  if (typeof timer === 'object' && timer !== null && typeof (timer as NodeJS.Timeout).unref === 'function') {
    (timer as NodeJS.Timeout).unref();
  }
}

function createTimeoutSignal(parent?: AbortSignal): AbortSignal {
  if (!parent) {
    if (typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(SERVICE_CLIENT_TIMEOUT_MS);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVICE_CLIENT_TIMEOUT_MS);
    maybeUnref(timer);
    return controller.signal;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_CLIENT_TIMEOUT_MS);
  maybeUnref(timer);
  const onAbort = () => controller.abort();

  if (parent.aborted) {
    onAbort();
  } else {
    parent.addEventListener('abort', onAbort, { once: true });
  }

  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
    { once: true }
  );

  return controller.signal;
}

export function resolveServiceUrl(baseUrl: string, targetPath: string) {
  if (!targetPath || targetPath === '/') {
    return baseUrl;
  }
  try {
    return new URL(targetPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch (err) {
    throw new Error(`Failed to resolve service URL: ${(err as Error).message}`);
  }
}

export async function fetchFromService(
  service: ServiceRecord,
  path: string,
  init?: RequestInit & { signal?: AbortSignal }
) {
  const requestInit: RequestInit = {
    ...init,
    headers: new Headers(init?.headers)
  };

  const headers = requestInit.headers as Headers;
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', 'apphub-service-client/1.0');
  }

  requestInit.signal = createTimeoutSignal(init?.signal);

  const metadata = parseMetadata(service);
  const runtimeBaseUrl = metadata.runtime?.instanceUrl ?? metadata.runtime?.baseUrl ?? metadata.runtime?.previewUrl ?? null;
  const fallbackBaseUrl = typeof service.baseUrl === 'string' && service.baseUrl.trim().length > 0
    ? service.baseUrl
    : null;

  const baseUrl = runtimeBaseUrl ?? fallbackBaseUrl;
  if (!baseUrl) {
    throw new Error(`Service ${service.slug} does not have a reachable base URL`);
  }

  const url = resolveServiceUrl(baseUrl, path);
  return fetch(url, requestInit);
}
