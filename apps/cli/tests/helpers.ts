import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';

export async function createTempDir(prefix = 'apphub-cli-test-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return dir;
}
