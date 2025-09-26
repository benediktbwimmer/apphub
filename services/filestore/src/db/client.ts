import { createPostgresPool } from '@apphub/shared';
import { loadServiceConfig } from '../config/serviceConfig';

const config = loadServiceConfig();

const poolHelpers = createPostgresPool({
  connectionString: config.database.url,
  max: config.database.maxConnections,
  idleTimeoutMillis: config.database.idleTimeoutMs,
  connectionTimeoutMillis: config.database.connectionTimeoutMs,
  schema: config.database.schema
});

export const { getClient, withConnection, withTransaction, closePool, getPool } = poolHelpers;
export const POSTGRES_SCHEMA = config.database.schema;
