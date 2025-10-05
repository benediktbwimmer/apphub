import EmbeddedPostgres from 'embedded-postgres';

const activeInstances = new Set<EmbeddedPostgres>();

type EmbeddedPostgresOptions = ConstructorParameters<typeof EmbeddedPostgres>[0];

export function createEmbeddedPostgres(options?: EmbeddedPostgresOptions): EmbeddedPostgres {
  if (options && typeof options === 'object') {
    const info = {
      databaseDir: (options as { databaseDir?: string }).databaseDir,
      port: (options as { port?: number }).port
    };
    console.info('[timestore:test] starting embedded Postgres', info);
  }
  const instance = new EmbeddedPostgres(options as EmbeddedPostgresOptions);
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
