import { listServices, type JsonValue, type ServiceKind, type ServiceRecord, type ServiceStatus } from '../db';

const SERVICE_CLIENT_TIMEOUT_MS = Number(process.env.SERVICE_CLIENT_TIMEOUT_MS ?? 60_000);

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
  containerIp?: string | null;
  containerPort?: number | null;
  containerBaseUrl?: string | null;
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
  if (typeof value.containerIp === 'string') {
    runtime.containerIp = value.containerIp;
  }
  if (typeof value.containerPort === 'number' && Number.isFinite(value.containerPort)) {
    runtime.containerPort = value.containerPort;
  }
  if (typeof value.containerBaseUrl === 'string') {
    runtime.containerBaseUrl = value.containerBaseUrl;
  }
  if (typeof value.status === 'string') {
    runtime.status = value.status;
  }
  if (typeof value.updatedAt === 'string') {
    runtime.updatedAt = value.updatedAt;
  }

  return Object.keys(runtime).length > 0 ? runtime : undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0.0.0.0']);

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const LOOPBACK_REWRITE_HOST = (() => {
  const candidate = process.env.APPHUB_SERVICE_REGISTRY_LOOPBACK_HOST?.trim();
  if (candidate && candidate.length > 0) {
    return candidate;
  }
  return 'host.docker.internal';
})();

const LOOPBACK_REWRITE_ENABLED =
  LOOPBACK_REWRITE_HOST.length > 0 && !envFlagEnabled(process.env.APPHUB_DISABLE_LOOPBACK_REWRITE);

function rewriteLoopbackHost(urlValue: string | null | undefined): string | null {
  if (!LOOPBACK_REWRITE_ENABLED) {
    return urlValue ?? null;
  }
  if (!urlValue) {
    return null;
  }

  try {
    const parsed = new URL(urlValue);
    const hostname = parsed.hostname.toLowerCase();

    if (LOOPBACK_HOSTS.has(hostname) || hostname.startsWith('127.')) {
      parsed.hostname = LOOPBACK_REWRITE_HOST;
      return parsed.toString();
    }
    return urlValue;
  } catch {
    if (urlValue.includes('localhost')) {
      return urlValue.replace(/localhost/gi, LOOPBACK_REWRITE_HOST);
    }
    return urlValue;
  }
}

function buildBaseUrlFromHostPort(hostValue: string | null | undefined, portValue: number | null | undefined): string | null {
  if (!hostValue) {
    return null;
  }
  const trimmedHost = hostValue.trim();
  if (!trimmedHost) {
    return null;
  }
  const numericPort = typeof portValue === 'number' && Number.isFinite(portValue) ? portValue : null;
  if (!numericPort) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedHost)) {
    try {
      const url = new URL(trimmedHost);
      url.port = String(numericPort);
      return url.toString();
    } catch {
      return null;
    }
  }

  return `http://${trimmedHost}:${numericPort}`;
}

function collectServiceBaseUrls(service: ServiceRecord, metadata: ServiceMetadataSnapshot): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const runtime = metadata.runtime ?? {};

  const push = (value: string | null | undefined, options?: { rewriteLoopback?: boolean }) => {
    if (!value || typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const addCandidate = (candidate: string | null | undefined) => {
      const normalized = candidate?.trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      candidates.push(normalized);
    };

    const shouldRewrite = options?.rewriteLoopback !== false;
    const rewritten = shouldRewrite ? rewriteLoopbackHost(trimmed) : trimmed;
    const resolved = (rewritten ?? trimmed).trim();

    addCandidate(resolved);

    if (shouldRewrite && resolved !== trimmed) {
      // Keep the original loopback address as a fallback for local execution environments.
      addCandidate(trimmed);
    }
  };

  push(runtime.containerBaseUrl ?? null, { rewriteLoopback: false });
  if (runtime.containerIp && runtime.containerPort) {
    push(`http://${runtime.containerIp}:${runtime.containerPort}`, { rewriteLoopback: false });
  }

  push(runtime.instanceUrl ?? null);
  push(runtime.baseUrl ?? null);
  push(runtime.previewUrl ?? null);
  push(buildBaseUrlFromHostPort(runtime.host ?? null, runtime.port ?? null));

  const fallbackBaseUrl = typeof service.baseUrl === 'string' && service.baseUrl.trim().length > 0
    ? service.baseUrl
    : null;
  push(fallbackBaseUrl);

  return candidates;
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
): Promise<{ response: Response; baseUrl: string }> {
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
  const baseUrls = collectServiceBaseUrls(service, metadata);

  if (baseUrls.length === 0) {
    throw new Error(`Service ${service.slug} does not have a reachable base URL`);
  }

  let lastError: unknown = null;
  for (const baseUrl of baseUrls) {
    try {
      const url = resolveServiceUrl(baseUrl, path);
      const response = await fetch(url, requestInit);
      return { response, baseUrl };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Service ${service.slug} request failed`);
}
