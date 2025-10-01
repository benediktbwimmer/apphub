import { requestJson } from './httpClient';
import type { ObservatoryContext } from './observatory';
import { FILESTORE_BASE_URL, METASTORE_BASE_URL, TIMESTORE_BASE_URL } from './env';

function log(message: string, details?: Record<string, unknown>): void {
  if (details && Object.keys(details).length > 0) {
    console.info(`[verify] ${message}`, details);
    return;
  }
  console.info(`[verify] ${message}`);
}

export async function verifyFilestoreIngest(context: ObservatoryContext): Promise<void> {
  const backendId = context.config.filestore.backendMountId;
  if (!backendId) {
    throw new Error('Observatory filestore backend mount id missing in configuration.');
  }

  log('Checking filestore backend registration', { backendId });
  const mounts = await requestJson<{ data: { mounts: Array<{ id: number }> } }>(
    `${FILESTORE_BASE_URL}/v1/backend-mounts`,
    { expectedStatus: 200 }
  );
  const mountExists = mounts.data.mounts.some((entry) => entry.id === backendId);
  if (!mountExists) {
    throw new Error(`Backend mount ${backendId} not registered with filestore.`);
  }

  const inboxPath = context.config.filestore.stagingPrefix;
  log('Confirming ingest directory exists', { backendId, inboxPath });
  await requestJson(`${FILESTORE_BASE_URL}/v1/nodes/by-path?backendMountId=${backendId}&path=${encodeURIComponent(inboxPath)}`, {
    expectedStatus: 200
  });
  log('Filestore ingest verified', { backendId });
}

export async function verifyMetastore(): Promise<void> {
  log('Verifying metastore availability', { url: `${METASTORE_BASE_URL}/namespaces` });
  await requestJson(`${METASTORE_BASE_URL}/namespaces`, {
    expectedStatus: 200
  });
  log('Metastore verification complete');
}

export async function verifyTimestore(): Promise<void> {
  log('Verifying timestore availability', { url: `${TIMESTORE_BASE_URL}/sql/schema` });
  await requestJson(`${TIMESTORE_BASE_URL}/sql/schema`, {
    expectedStatus: 200
  });
  log('Timestore verification complete');
}
