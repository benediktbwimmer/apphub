import { requestJson } from './httpClient';
import type { ObservatoryContext } from './observatory';

const METASTORE_BASE_URL = 'http://127.0.0.1:4100';
const TIMESTORE_BASE_URL = 'http://127.0.0.1:4200';
const FILESTORE_BASE_URL = 'http://127.0.0.1:4300';

export async function verifyFilestoreIngest(context: ObservatoryContext): Promise<void> {
  const backendId = context.config.filestore.backendMountId;
  if (!backendId) {
    throw new Error('Observatory filestore backend mount id missing in configuration.');
  }

  const mounts = await requestJson<{ data: { mounts: Array<{ id: number }> } }>(
    `${FILESTORE_BASE_URL}/v1/backend-mounts`,
    { expectedStatus: 200 }
  );
  const mountExists = mounts.data.mounts.some((entry) => entry.id === backendId);
  if (!mountExists) {
    throw new Error(`Backend mount ${backendId} not registered with filestore.`);
  }

  const inboxPath = context.config.filestore.stagingPrefix;
  await requestJson(`${FILESTORE_BASE_URL}/v1/nodes/by-path?backendMountId=${backendId}&path=${encodeURIComponent(inboxPath)}`, {
    expectedStatus: 200
  });
}

export async function verifyMetastore(): Promise<void> {
  await requestJson(`${METASTORE_BASE_URL}/namespaces`, {
    expectedStatus: 200
  });
}

export async function verifyTimestore(): Promise<void> {
  await requestJson(`${TIMESTORE_BASE_URL}/sql/schema`, {
    expectedStatus: 200
  });
}
