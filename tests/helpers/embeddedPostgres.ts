import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import EmbeddedPostgres from 'embedded-postgres';

type EmbeddedPostgresOptions = ConstructorParameters<typeof EmbeddedPostgres>[0];

type InstanceMetadata = {
  dataDir: string | null;
  persistent: boolean;
};

const activeInstances = new Set<EmbeddedPostgres>();
const instanceMetadata = new WeakMap<EmbeddedPostgres, InstanceMetadata>();

function upsertPostgresFlag(flags: string[], key: string, value: string): void {
  const pattern = `${key}=`;
  if (flags.some((flag) => typeof flag === 'string' && flag.includes(pattern))) {
    return;
  }
  flags.push('-c', `${key}=${value}`);
}

function ensurePostgresFlags(input: string[] | undefined): string[] {
  const flags = Array.isArray(input) ? [...input] : [];
  upsertPostgresFlag(flags, 'shared_memory_type', 'mmap');
  upsertPostgresFlag(flags, 'dynamic_shared_memory_type', 'posix');
  return flags;
}

function clearSharedMemorySegmentsSync(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return;
  }
  if (typeof process.getuid !== 'function') {
    return;
  }

  const uid = process.getuid();
  const ipcs = spawnSync('ipcs', ['-m'], { encoding: 'utf8' });
  if (ipcs.status !== 0 || !ipcs.stdout) {
    return;
  }

  const segmentIds: string[] = [];
  const userName = process.env.USER ?? null;
  for (const line of ipcs.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('------') || trimmed.startsWith('T ')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }

    let idToken: string | null = null;
    let ownerToken: string | null = null;

    if (parts[0] === 'm' || parts[0] === 'q' || parts[0] === 's') {
      idToken = parts[1] ?? null;
      ownerToken = parts[4] ?? null;
    } else {
      idToken = parts[0] ?? null;
      ownerToken = parts[2] ?? null;
    }

    if (!idToken) {
      continue;
    }

    if (ownerToken) {
      const ownerUid = Number.parseInt(ownerToken, 10);
      if (Number.isNaN(ownerUid)) {
        if (userName && ownerToken !== userName) {
          continue;
        }
      } else if (ownerUid !== uid) {
        continue;
      }
    } else if (userName) {
      // without owner information we skip removal
      continue;
    }

    segmentIds.push(idToken);
  }

  if (segmentIds.length === 0) {
    return;
  }

  for (const segmentId of segmentIds) {
    const result = spawnSync('ipcrm', ['-m', segmentId]);
    if (result.status !== 0 && result.stderr) {
      console.warn('[embedded-postgres] failed to clear shared memory segment', {
        segmentId,
        error: result.stderr.toString()
      });
    }
  }
}

function removeDataDirectorySync(directory: string | null): void {
  if (!directory) {
    return;
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.warn('[embedded-postgres] failed to remove existing data directory', { directory, error });
  }
}

export function createEmbeddedPostgres(options?: EmbeddedPostgresOptions): EmbeddedPostgres {
  clearSharedMemorySegmentsSync();

  const normalizedOptions = {
    ...(options ?? {}),
    postgresFlags: ensurePostgresFlags(
      (options as EmbeddedPostgresOptions | undefined)?.postgresFlags as string[] | undefined
    )
  } as EmbeddedPostgresOptions;

  const dataDir =
    typeof (normalizedOptions as { databaseDir?: unknown }).databaseDir === 'string'
      ? ((normalizedOptions as { databaseDir?: string }).databaseDir ?? null)
      : null;

  if (dataDir) {
    removeDataDirectorySync(dataDir);
  }

  const instance = new EmbeddedPostgres(normalizedOptions);
  activeInstances.add(instance);
  instanceMetadata.set(instance, {
    dataDir,
    persistent: Boolean((normalizedOptions as { persistent?: boolean }).persistent)
  });
  return instance;
}

export async function stopEmbeddedPostgres(instance: EmbeddedPostgres | null | undefined): Promise<void> {
  if (!instance) {
    return;
  }
  const metadata = instanceMetadata.get(instance);

  try {
    await instance.stop();
  } catch (error) {
    console.warn('[embedded-postgres] failed to stop instance', error);
  } finally {
    activeInstances.delete(instance);
    if (metadata && metadata.dataDir && !metadata.persistent) {
      try {
        await rm(metadata.dataDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('[embedded-postgres] failed to remove data directory', { directory: metadata.dataDir, error });
      }
    }
    clearSharedMemorySegmentsSync();
  }
}

export async function stopAllEmbeddedPostgres(): Promise<void> {
  const instances = Array.from(activeInstances);
  for (const instance of instances) {
    await stopEmbeddedPostgres(instance);
  }
}
