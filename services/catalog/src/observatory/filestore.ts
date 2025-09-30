import { randomUUID } from 'node:crypto';
import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';
import type { CommandResponse } from '@apphub/filestore-client';
import { getObservatoryCalibrationConfig } from '../config/observatory';
import type { CalibrationPlanStorage } from './calibrationTypes';

let cachedClient: FilestoreClient | null = null;

async function getClient(): Promise<FilestoreClient> {
  if (cachedClient) {
    return cachedClient;
  }
  const config = await getObservatoryCalibrationConfig();
  const runtime = config.filestore.runtime;
  cachedClient = new FilestoreClient({
    baseUrl: runtime.baseUrl,
    token: runtime.token ?? undefined,
    userAgent: runtime.userAgent,
    fetchTimeoutMs: runtime.fetchTimeoutMs ?? undefined
  });
  return cachedClient;
}

export function clearObservatoryFilestoreClient(): void {
  cachedClient = null;
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/g, '');
}

async function ensureDirectoryHierarchy(
  client: FilestoreClient,
  backendMountId: number,
  path: string,
  principal: string | null
): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized) {
    return;
  }
  const segments = normalized.split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await client.createDirectory({
        backendMountId,
        path: current,
        principal: principal ?? undefined,
        idempotencyKey: `observatory-dir-${current}`
      });
    } catch (error) {
      if (error instanceof FilestoreClientError) {
        if (error.statusCode === 409 || error.code === 'directory_exists') {
          continue;
        }
      }
      throw error;
    }
  }
}

async function readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Buffer) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function uploadCalibrationFile(
  content: string,
  filename: string,
  options: { principal?: string | null; overwrite?: boolean; metadata?: Record<string, unknown> } = {}
): Promise<{
  command: CommandResponse<Record<string, unknown>>;
  path: string;
}> {
  const config = await getObservatoryCalibrationConfig();
  const client = await getClient();
  const backendId = config.filestore.backendId;
  const principal = options.principal ?? config.filestore.importPrincipal ?? undefined;
  const prefix = normalizePath(config.filestore.calibrationsPrefix);
  const path = normalizePath(`${prefix}/${filename}`);

  await ensureDirectoryHierarchy(client, backendId, prefix, principal ?? null);

  const command = await client.uploadFile({
    backendMountId: backendId,
    path,
    content,
    contentType: 'application/json; charset=utf-8',
    overwrite: options.overwrite ?? false,
    principal,
    metadata: options.metadata,
    idempotencyKey: randomUUID()
  });

  return { command, path };
}

export async function loadPlanArtifact(
  storage: CalibrationPlanStorage,
  options: { principal?: string | null } = {}
): Promise<{ content: string; nodeId: number | null; path: string } | null> {
  const config = await getObservatoryCalibrationConfig();
  const client = await getClient();
  const backendId = config.filestore.backendId;
  const principal = options.principal ?? config.filestore.reprocessPrincipal ?? undefined;
  const planPath = normalizePath(storage.planPath ?? '');
  if (!planPath) {
    return null;
  }

  const nodeId = storage.nodeId ?? null;

  if (nodeId) {
    const download = await client.downloadFile(nodeId, { principal });
    const content = await readStreamToString(download.stream);
    return { content, nodeId, path: planPath };
  }

  const targetNode = await client.getNodeByPath({
    backendMountId: backendId,
    path: planPath
  });
  const download = await client.downloadFile(targetNode.id, { principal });
  const content = await readStreamToString(download.stream);
  return { content, nodeId: targetNode.id ?? null, path: planPath };
}
