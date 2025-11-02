import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import { withConnection } from '../db/client';
import {
  createBackendMount,
  updateBackendMount,
  type CreateBackendMountInput,
  type UpdateBackendMountInput
} from '../db/backendMounts';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function cleanString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildLabels(envValue: string | undefined, defaults: string[]): string[] {
  const raw = cleanString(envValue);
  if (!raw) {
    return Array.from(new Set(defaults));
  }
  const values = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const merged = [...defaults, ...values];
  return Array.from(new Set(merged));
}

type AutoProvisionContext = {
  logger: FastifyBaseLogger;
};

export async function autoProvisionDefaultBackend(context: AutoProvisionContext): Promise<void> {
  const { logger } = context;
  const env = process.env;
  const defaultEnabled = env.NODE_ENV?.trim().toLowerCase() !== 'production';
  const enabled = parseBoolean(env.FILESTORE_AUTOPROVISION_DEFAULT_BACKEND, defaultEnabled);

  if (!enabled) {
    logger.debug('filestore auto-provisioning disabled');
    return;
  }

  const rawKind = cleanString(env.FILESTORE_AUTOPROVISION_BACKEND_KIND) ?? 's3';
  const backendKind = rawKind.toLowerCase();

  if (backendKind === 'local') {
    const mountKey = cleanString(env.FILESTORE_AUTOPROVISION_MOUNT_KEY) ?? 'observatory-local';
    const displayName = cleanString(env.FILESTORE_AUTOPROVISION_DISPLAY_NAME) ?? 'Observatory Filestore (Local)';
    const description =
      cleanString(env.FILESTORE_AUTOPROVISION_DESCRIPTION) ??
      'Auto-provisioned local filesystem mount for the observatory example.';

    const configuredRoot =
      cleanString(env.FILESTORE_AUTOPROVISION_LOCAL_ROOT) ??
      cleanString(env.OBSERVATORY_FILESTORE_LOCAL_ROOT) ??
      path.join(process.cwd(), 'data', 'local', 'storage', 'apphub-filestore');
    const rootPath = path.isAbsolute(configuredRoot)
      ? configuredRoot
      : path.join(process.cwd(), configuredRoot);
    await mkdir(rootPath, { recursive: true });

    const labels = buildLabels(env.FILESTORE_AUTOPROVISION_LABELS, ['autoprovisioned', 'observatory']);

    const createPayload: CreateBackendMountInput = {
      mountKey,
      backendKind: 'local',
      rootPath,
      accessMode: 'rw',
      state: 'active',
      displayName,
      description,
      labels
    };

    const updatePayload: UpdateBackendMountInput = {
      rootPath,
      accessMode: 'rw',
      state: 'active',
      displayName,
      description,
      labels
    };

    await withConnection(async (client) => {
      const existing = await client.query<{ id: number }>(
        'SELECT id FROM backend_mounts WHERE mount_key = $1 LIMIT 1',
        [mountKey]
      );

      if (existing.rowCount === 0) {
        await createBackendMount(client, createPayload);
        logger.info({ mountKey, backendKind: 'local', rootPath }, 'auto-provisioned local filestore backend mount');
        return;
      }

      const mountId = existing.rows[0].id;
      await updateBackendMount(client, mountId, updatePayload);
      logger.info({ mountKey, backendKind: 'local', rootPath }, 'refreshed auto-provisioned local filestore backend');
    });

    return;
  }

  if (backendKind !== 's3') {
    logger.warn({ backendKind }, 'filestore auto-provision only supports local and s3 backends');
    return;
  }

  const mountKey = cleanString(env.FILESTORE_AUTOPROVISION_MOUNT_KEY) ?? 'observatory-s3';
  const displayName = cleanString(env.FILESTORE_AUTOPROVISION_DISPLAY_NAME) ?? 'Observatory Filestore';
  const description =
    cleanString(env.FILESTORE_AUTOPROVISION_DESCRIPTION) ?? 'Auto-provisioned S3 mount for the observatory example.';

  const bucket =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_BUCKET) ??
    cleanString(env.OBSERVATORY_FILESTORE_S3_BUCKET) ??
    cleanString(env.FILESTORE_S3_BUCKET) ??
    cleanString(env.APPHUB_BUNDLE_STORAGE_BUCKET) ??
    'apphub-filestore';

  if (!bucket) {
    logger.warn({ mountKey }, 'skipping filestore auto-provision because no S3 bucket is configured');
    return;
  }

  const prefix =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_PREFIX) ?? cleanString(env.OBSERVATORY_FILESTORE_S3_PREFIX) ?? null;

  const endpoint =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_ENDPOINT) ??
    cleanString(env.OBSERVATORY_FILESTORE_S3_ENDPOINT) ??
    cleanString(env.FILESTORE_S3_ENDPOINT) ??
    cleanString(env.APPHUB_BUNDLE_STORAGE_ENDPOINT) ??
    'http://127.0.0.1:9000';

  const region =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_REGION) ??
    cleanString(env.OBSERVATORY_FILESTORE_S3_REGION) ??
    cleanString(env.FILESTORE_S3_REGION) ??
    cleanString(env.APPHUB_BUNDLE_STORAGE_REGION) ??
    'us-east-1';

  const forcePathStyle = parseBoolean(
    env.FILESTORE_AUTOPROVISION_S3_FORCE_PATH_STYLE ??
      env.OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE ??
      env.FILESTORE_S3_FORCE_PATH_STYLE ??
      env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE,
    true
  );

  const accessKeyId =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_ACCESS_KEY_ID) ??
    cleanString(env.OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID) ??
    cleanString(env.FILESTORE_S3_ACCESS_KEY_ID) ??
    cleanString(env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID) ??
    undefined;

  const secretAccessKey =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_SECRET_ACCESS_KEY) ??
    cleanString(env.OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY) ??
    cleanString(env.FILESTORE_S3_SECRET_ACCESS_KEY) ??
    cleanString(env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY) ??
    undefined;

  const sessionToken =
    cleanString(env.FILESTORE_AUTOPROVISION_S3_SESSION_TOKEN) ??
    cleanString(env.OBSERVATORY_FILESTORE_S3_SESSION_TOKEN) ??
    cleanString(env.FILESTORE_S3_SESSION_TOKEN) ??
    undefined;

  const labels = buildLabels(env.FILESTORE_AUTOPROVISION_LABELS, ['autoprovisioned', 'observatory']);

  const config: Record<string, unknown> = {
    region,
    endpoint,
    forcePathStyle
  };
  if (accessKeyId) {
    config.accessKeyId = accessKeyId;
  }
  if (secretAccessKey) {
    config.secretAccessKey = secretAccessKey;
  }
  if (sessionToken) {
    config.sessionToken = sessionToken;
  }

  const createPayload: CreateBackendMountInput = {
    mountKey,
    backendKind: 's3',
    bucket,
    prefix,
    config,
    accessMode: 'rw',
    state: 'active',
    displayName,
    description,
    labels
  };

  const updatePayload: UpdateBackendMountInput = {
    bucket,
    prefix,
    accessMode: 'rw',
    state: 'active',
    displayName,
    description,
    labels,
    config
  };

  await withConnection(async (client) => {
    const existing = await client.query<{ id: number }>(
      'SELECT id FROM backend_mounts WHERE mount_key = $1 LIMIT 1',
      [mountKey]
    );

    if (existing.rowCount === 0) {
      await createBackendMount(client, createPayload);
      logger.info({ mountKey, backendKind: 's3', bucket }, 'auto-provisioned filestore backend mount');
      return;
    }

    const mountId = existing.rows[0].id;
    await updateBackendMount(client, mountId, updatePayload);
    logger.info({ mountKey, backendKind: 's3', bucket }, 'refreshed auto-provisioned filestore backend mount');
  });
}
