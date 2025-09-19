import { listServices, type JsonValue, type ServiceKind, type ServiceRecord, type ServiceStatus } from '../db';

const SERVICE_CLIENT_TIMEOUT_MS = Number(process.env.SERVICE_CLIENT_TIMEOUT_MS ?? 5_000);

const STATUS_PRIORITY: Record<ServiceStatus, number> = {
  healthy: 0,
  degraded: 1,
  unknown: 2,
  unreachable: 3
};

export type ServiceMetadataSnapshot = {
  manifest?: Record<string, unknown>;
  config?: Record<string, unknown>;
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

function parseMetadata(record: ServiceRecord): ServiceMetadataSnapshot {
  const raw = parseJsonObject(record.metadata ?? null);
  const manifest = raw?.manifest && typeof raw.manifest === 'object' && !Array.isArray(raw.manifest)
    ? { ...(raw.manifest as Record<string, unknown>) }
    : undefined;
  const config = raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
    ? { ...(raw.config as Record<string, unknown>) }
    : undefined;
  return {
    manifest,
    config,
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

export function getResolvedService(kind: ServiceKind, options?: { requireHealthy?: boolean }): ResolvedService | null {
  const requireHealthy = options?.requireHealthy ?? false;
  const candidates = listServices()
    .filter((service) => service.kind === kind)
    .sort(compareServices);

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

export function requireResolvedService(kind: ServiceKind, options?: { requireHealthy?: boolean }): ResolvedService {
  const resolved = getResolvedService(kind, options);
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

  const url = resolveServiceUrl(service.baseUrl, path);
  return fetch(url, requestInit);
}
