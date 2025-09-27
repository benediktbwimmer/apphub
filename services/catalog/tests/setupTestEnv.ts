import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { tmpdir } from 'node:os';

const ipcDir = path.join(tmpdir(), 'apphub-tsx-ipc');
try {
  fs.mkdirSync(ipcDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(ipcDir, 0o700);
} catch {
  // best effort
}

if (!process.env.APPHUB_EVENTS_MODE) {
  process.env.APPHUB_EVENTS_MODE = 'redis';
}
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
}
process.env.TSX_UNSAFE_HOOKS = '1';
process.env.TSX_IPC_HOOK_PATH = path.join(ipcDir, `ipc-${randomUUID()}.sock`);
process.env.APPHUB_DISABLE_ANALYTICS = '1';
process.env.APPHUB_ANALYTICS_INTERVAL_MS = '0';
process.env.APPHUB_DISABLE_SERVICE_POLLING = '1';

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
