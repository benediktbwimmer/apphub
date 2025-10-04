import {
  FilestoreClient,
  FilestoreClientError
} from '@apphub/filestore-client';
import type { FilestoreBackendMountRecord } from '@apphub/filestore-client';
import { ensureS3Bucket } from '@apphub/module-registry';
import type { ModuleDeploymentLogger, FilestoreProvisioning } from './types';
import { fetch } from 'undici';

export interface EnsurePrefixesOptions extends FilestoreProvisioning {
  logger: ModuleDeploymentLogger;
}

export async function ensureFilestorePrefixes(options: EnsurePrefixesOptions): Promise<number> {
  if (!options.prefixes.length) {
    return 0;
  }

  const client = new FilestoreClient({
    baseUrl: options.baseUrl,
    token: options.token ?? undefined,
    userAgent: 'apphub-cli/module-deploy'
  });

  const backendMountId = await resolveBackendMountId(client, {
    backendMountId: options.backendMountId,
    backendMountKey: options.backendMountKey
  });

  const uniquePrefixes = Array.from(new Set(options.prefixes.map((prefix) => normalizePrefix(prefix)))).filter(
    (prefix) => prefix.length > 0
  );

  for (const prefix of uniquePrefixes) {
    await ensureHierarchy(client, backendMountId, prefix, options.principal ?? undefined, options.logger);
  }

  return uniquePrefixes.length;
}

export async function ensureFilestoreBackend(options: EnsurePrefixesOptions): Promise<number | null> {
  if (process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP === '1') {
    options.logger.info('Skipped filestore backend provisioning (disabled via env)', {});
    return options.backendMountId ?? null;
  }

  const headers = {
    'content-type': 'application/json',
    'x-iam-scopes': 'filestore:admin',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
  } as Record<string, string>;

  const client = new FilestoreClient({
    baseUrl: options.baseUrl,
    token: options.token ?? undefined,
    userAgent: 'apphub-cli/module-deploy'
  });

  let existing: FilestoreBackendMountRecord | null = options.backendMountKey
    ? await client.findBackendMountByKey(options.backendMountKey)
    : null;

  if (!existing && options.backendMountId) {
    existing = await fetchBackendMount(options.baseUrl, options.backendMountId, headers);
  }

  const desiredBucket = options.bucket ?? 'apphub-filestore';
  const desiredConfig = {
    endpoint: options.endpoint ?? 'http://127.0.0.1:9000',
    region: options.region ?? 'us-east-1',
    force_path_style: options.forcePathStyle !== false,
    accessKeyId: options.accessKeyId ?? 'apphub',
    secretAccessKey: options.secretAccessKey ?? 'apphub123',
    sessionToken: options.sessionToken ?? undefined
  } as Record<string, unknown>;

  let backendId: number;

  if (existing) {
    backendId = existing.id;
    const body = {
      bucket: desiredBucket,
      prefix: null,
      accessMode: 'rw',
      state: 'active',
      config: desiredConfig
    };
    await requestFilestore('PATCH', options.baseUrl, `/v1/backend-mounts/${backendId}`, headers, body);
    options.logger.info('Reused existing filestore backend', { backendId });
  } else {
    const mountKey = options.backendMountKey || `observatory-${Date.now()}`;
    const body = {
      mountKey,
      backendKind: 's3',
      bucket: desiredBucket,
      prefix: null,
      accessMode: 'rw',
      state: 'active',
      config: desiredConfig,
      displayName: 'Observatory (module)'
    };
    const created = await requestFilestore('POST', options.baseUrl, '/v1/backend-mounts', headers, body);
    backendId = created.data.id;
    options.logger.info('Created filestore backend', { backendId });
  }

  await ensureS3Bucket({
    bucket: desiredBucket,
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    sessionToken: options.sessionToken
  });
  options.logger.info('Ensured S3 bucket for filestore backend', {
    bucket: desiredBucket,
    endpoint: options.endpoint ?? null
  });

  return backendId;
}

async function fetchBackendMount(
  baseUrl: string,
  id: number,
  headers: Record<string, string>
): Promise<FilestoreBackendMountRecord | null> {
  const response = await fetch(new URL(`/v1/backend-mounts/${id}`, baseUrl), {
    method: 'GET',
    headers
  });
  if (!response.ok) {
    return null;
  }
  const envelope = (await response.json()) as { data: FilestoreBackendMountRecord };
  return envelope.data;
}

async function requestFilestore(
  method: 'GET' | 'POST' | 'PATCH',
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>
) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Filestore request failed (${response.status}): ${text}`);
  }
  if (response.status === 204) {
    return {};
  }
  return response.json() as Promise<Record<string, any>>;
}

interface BackendLocator {
  backendMountId?: number | null;
  backendMountKey?: string | null;
}

async function resolveBackendMountId(client: FilestoreClient, locator: BackendLocator): Promise<number> {
  const candidate = locator.backendMountId;
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }

  const key = locator.backendMountKey?.trim();
  if (!key) {
    throw new Error('backendMountId or backendMountKey is required to resolve a filestore backend');
  }

  const existing = await client.findBackendMountByKey(key);
  if (!existing) {
    throw new Error(`Filestore backend mount with key '${key}' was not found`);
  }

  return existing.id;
}

async function ensureHierarchy(
  client: FilestoreClient,
  backendMountId: number,
  prefix: string,
  principal: string | undefined,
  logger: ModuleDeploymentLogger
): Promise<void> {
  const segments = prefix.split('/');
  let current = '';

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }
    current = current ? `${current}/${segment}` : segment;

    try {
      await client.createDirectory({
        backendMountId,
        path: current,
        principal
      });
      logger.info('Created filestore prefix', { backendMountId, path: current });
    } catch (error) {
      if (error instanceof FilestoreClientError && error.code === 'NODE_EXISTS') {
        continue;
      }
      if ((error as { status?: number }).status === 409) {
        continue;
      }
      throw error;
    }
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, '');
}
