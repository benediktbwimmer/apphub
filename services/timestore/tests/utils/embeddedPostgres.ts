import EmbeddedPostgres from 'embedded-postgres';

const activeInstances = new Set<EmbeddedPostgres>();

type EmbeddedPostgresOptions = ConstructorParameters<typeof EmbeddedPostgres>[0];

function ensureSharedMemoryFlag(flags: string[] | undefined): string[] {
  const normalized = Array.isArray(flags) ? [...flags] : [];
  const hasSharedMemorySetting = normalized.some((flag) =>
    typeof flag === 'string' && flag.includes('shared_memory_type=')
  );
  if (!hasSharedMemorySetting) {
    normalized.push('-c', 'shared_memory_type=mmap');
  }
  return normalized;
}

export function createEmbeddedPostgres(options?: EmbeddedPostgresOptions): EmbeddedPostgres {
  const normalizedOptions = {
    ...(options ?? {}),
    postgresFlags: ensureSharedMemoryFlag((options as { postgresFlags?: string[] } | undefined)?.postgresFlags)
  } as EmbeddedPostgresOptions;

  const info = {
    databaseDir: (normalizedOptions as { databaseDir?: string }).databaseDir,
    port: (normalizedOptions as { port?: number }).port
  };
  console.info('[timestore:test] starting embedded Postgres', info);

  const instance = new EmbeddedPostgres(normalizedOptions);
  activeInstances.add(instance);
  return instance;
}

export async function stopEmbeddedPostgres(instance: EmbeddedPostgres | null | undefined): Promise<void> {
  if (!instance) {
    return;
  }
  try {
    await instance.stop();
  } catch (error) {
    console.warn('[timestore:test] failed to stop embedded Postgres', error);
  } finally {
    activeInstances.delete(instance);
  }
}

export async function stopAllEmbeddedPostgres(): Promise<void> {
  const instances = Array.from(activeInstances);
  for (const instance of instances) {
    await stopEmbeddedPostgres(instance);
  }
}
