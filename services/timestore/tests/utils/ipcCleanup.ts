import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

type IpcKind = 'semaphore' | 'shared_memory';

type ParsedResource = {
  id: string;
  kind: IpcKind;
};

function parseIpcsOutput(output: string, username: string, kind: IpcKind): ParsedResource[] {
  const resources: ParsedResource[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (!(kind === 'semaphore' ? line.startsWith('s ') : line.startsWith('m '))) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }
    const [, id, , , owner] = parts;
    if (!id || owner !== username) {
      continue;
    }
    if (/^\d+$/.test(id)) {
      resources.push({ id, kind });
    }
  }
  return resources;
}

async function removeResource(resource: ParsedResource, logger: Console): Promise<void> {
  const flag = resource.kind === 'semaphore' ? '-s' : '-m';
  try {
    await execFileAsync('ipcrm', [flag, resource.id]);
  } catch (error) {
    logger?.warn?.('[timestore:test] failed to remove IPC resource', {
      kind: resource.kind,
      id: resource.id,
      error
    });
  }
}

export async function cleanupSystemIpc(logger: Console = console): Promise<void> {
  const username = os.userInfo().username;
  let resources: ParsedResource[] = [];

  try {
    const [{ stdout: semaphores }, { stdout: sharedMemory }] = await Promise.all([
      execFileAsync('ipcs', ['-s']),
      execFileAsync('ipcs', ['-m'])
    ]);
    resources = resources
      .concat(parseIpcsOutput(semaphores, username, 'semaphore'))
      .concat(parseIpcsOutput(sharedMemory, username, 'shared_memory'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return;
    }
    logger?.warn?.('[timestore:test] failed inspecting IPC resources', error);
    return;
  }

  if (resources.length === 0) {
    return;
  }

  for (const resource of resources) {
    await removeResource(resource, logger);
  }
}

