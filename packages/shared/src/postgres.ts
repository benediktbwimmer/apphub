import pg, { Pool, type PoolClient, type PoolConfig } from 'pg';

let int8Configured = false;

function configureGlobalParsers(): void {
  if (int8Configured) {
    return;
  }
  pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
  int8Configured = true;
}

function quoteIdentifier(input: string): string {
  return `"${input.replace(/"/g, '""')}"`;
}

export interface PostgresAcquireOptions {
  setSearchPath?: boolean;
}

export interface PostgresPoolOptions extends PoolConfig {
  schema?: string;
}

export interface PostgresHelpers {
  getClient(options?: PostgresAcquireOptions): Promise<PoolClient>;
  withConnection<T>(fn: (client: PoolClient) => Promise<T>, options?: PostgresAcquireOptions): Promise<T>;
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>, options?: PostgresAcquireOptions): Promise<T>;
  closePool(): Promise<void>;
  getPool(): Pool;
}

export function createPostgresPool(options: PostgresPoolOptions = {}): PostgresHelpers {
  configureGlobalParsers();
  const { schema, ...poolConfig } = options;
  const pool = new Pool(poolConfig);

  pool.on('error', (err: Error) => {
    console.error('[postgres] unexpected error on idle client', err);
  });

  async function prepareClient(client: PoolClient, setSearchPath: boolean | undefined): Promise<void> {
    if (schema && setSearchPath !== false) {
      await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
    }
  }

  async function getClient(options?: PostgresAcquireOptions): Promise<PoolClient> {
    const client = await pool.connect();
    try {
      await prepareClient(client, options?.setSearchPath);
    } catch (err) {
      client.release();
      throw err;
    }
    return client;
  }

  async function withConnection<T>(fn: (client: PoolClient) => Promise<T>, options?: PostgresAcquireOptions): Promise<T> {
    const client = await getClient(options);
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>, options?: PostgresAcquireOptions): Promise<T> {
    return withConnection(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[postgres] failed to rollback transaction', rollbackErr);
        }
        throw err;
      }
    }, options);
  }

  async function closePool(): Promise<void> {
    await pool.end();
  }

  function getPool(): Pool {
    return pool;
  }

  return {
    getClient,
    withConnection,
    withTransaction,
    closePool,
    getPool
  };
}
