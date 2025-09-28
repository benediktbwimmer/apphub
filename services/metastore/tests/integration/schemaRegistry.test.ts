import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { runE2E } from '@apphub/test-helpers';

const ADMIN_TOKEN = 'metastore-admin-token';
const READER_TOKEN = 'metastore-reader-token';
const WRITER_TOKEN = 'metastore-writer-token';

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine available port')));
      }
    });
  });
}

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

type MetastoreContext = {
  app: FastifyInstance;
  dataDir: string;
  postgres: EmbeddedPostgres;
};

async function setupMetastore(): Promise<MetastoreContext> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'metastore-schema-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.APPHUB_AUTH_DISABLED = '0';
  process.env.APPHUB_METRICS_ENABLED = '1';
  process.env.APPHUB_METASTORE_SCHEMA_CACHE_TTL_SECONDS = '2';
  process.env.APPHUB_METASTORE_SCHEMA_CACHE_NEGATIVE_TTL_SECONDS = '1';
  process.env.APPHUB_METASTORE_SCHEMA_CACHE_REFRESH_AHEAD_SECONDS = '1';
  process.env.APPHUB_METASTORE_SCHEMA_CACHE_REFRESH_INTERVAL_SECONDS = '1';

  const tokens = [
    {
      token: ADMIN_TOKEN,
      subject: 'admin',
      scopes: ['metastore:read', 'metastore:write', 'metastore:admin'],
      namespaces: '*',
      kind: 'service'
    },
    {
      token: READER_TOKEN,
      subject: 'reader',
      scopes: ['metastore:read'],
      namespaces: '*',
      kind: 'user'
    },
    {
      token: WRITER_TOKEN,
      subject: 'writer',
      scopes: ['metastore:write'],
      namespaces: '*',
      kind: 'service'
    }
  ];

  process.env.APPHUB_METASTORE_TOKENS = JSON.stringify(tokens);

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  const { resetServiceConfigCache } = await import('../../src/config/serviceConfig');
  resetServiceConfigCache();

  const { buildApp } = await import('../../src/app');
  const { app } = await buildApp();
  await app.ready();

  return { app, dataDir, postgres } satisfies MetastoreContext;
}

runE2E(async ({ registerCleanup }) => {
  const envSnapshot = snapshotEnv([
    'DATABASE_URL',
    'APPHUB_AUTH_DISABLED',
    'APPHUB_METRICS_ENABLED',
    'APPHUB_METASTORE_TOKENS',
    'APPHUB_METASTORE_SCHEMA_CACHE_TTL_SECONDS',
    'APPHUB_METASTORE_SCHEMA_CACHE_NEGATIVE_TTL_SECONDS',
    'APPHUB_METASTORE_SCHEMA_CACHE_REFRESH_AHEAD_SECONDS',
    'APPHUB_METASTORE_SCHEMA_CACHE_REFRESH_INTERVAL_SECONDS',
    'NODE_ENV'
  ]);

  registerCleanup(async () => {
    restoreEnv(envSnapshot);
  });

  const { app, dataDir, postgres } = await setupMetastore();

  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  registerCleanup(async () => {
    await postgres.stop();
  });

  registerCleanup(async () => {
    await app.close();
  });

  const schemaDefinition = {
    schemaHash: 'sha256:test-schema',
    name: 'Metrics payload',
    description: 'Schema used for metrics ingestion',
    version: '1.0.0',
    metadata: { owner: 'data-platform' },
    fields: [
      {
        path: 'id',
        type: 'string',
        description: 'Primary identifier',
        required: true
      },
      {
        path: 'payload.timestamp',
        type: 'string',
        description: 'ISO-8601 timestamp',
        required: true
      }
    ]
  } as const;

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/admin/schemas',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: schemaDefinition
  });
  assert.equal(registerResponse.statusCode, 201, registerResponse.body);
  const createdPayload = registerResponse.json() as {
    created: boolean;
    schema: { schemaHash: string; createdAt: string; updatedAt: string };
  };
  assert.equal(createdPayload.created, true);
  assert.equal(createdPayload.schema.schemaHash, schemaDefinition.schemaHash);

  const firstFetch = await app.inject({
    method: 'GET',
    url: `/schemas/${encodeURIComponent(schemaDefinition.schemaHash)}`,
    headers: { authorization: `Bearer ${READER_TOKEN}` }
  });
  assert.equal(firstFetch.statusCode, 200, firstFetch.body);
  const firstBody = firstFetch.json() as {
    cache: string;
    description?: string;
  };
  assert.equal(firstBody.cache, 'database');
  assert.equal(firstBody.description, schemaDefinition.description);
  assert.equal(firstFetch.headers['cache-control'], 'public, max-age=2');

  const secondFetch = await app.inject({
    method: 'GET',
    url: `/schemas/${encodeURIComponent(schemaDefinition.schemaHash)}`,
    headers: { authorization: `Bearer ${READER_TOKEN}` }
  });
  assert.equal(secondFetch.statusCode, 200, secondFetch.body);
  const secondBody = secondFetch.json() as { cache: string };
  assert.equal(secondBody.cache, 'cache');

  const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(metricsResponse.statusCode, 200, metricsResponse.body);
  assert.match(
    metricsResponse.body,
    /metastore_schema_cache_hits_total\{kind="positive"} 1/,
    'expected a positive cache hit in metrics output'
  );
  assert.match(
    metricsResponse.body,
    /metastore_schema_cache_misses_total\{reason="cold"} 1/,
    'expected exactly one cold cache miss'
  );

  const missingResponse = await app.inject({
    method: 'GET',
    url: '/schemas/sha256:missing',
    headers: { authorization: `Bearer ${READER_TOKEN}` }
  });
  assert.equal(missingResponse.statusCode, 404, missingResponse.body);
  assert.equal(missingResponse.headers['cache-control'], 'public, max-age=1');

  const forbiddenResponse = await app.inject({
    method: 'GET',
    url: `/schemas/${encodeURIComponent(schemaDefinition.schemaHash)}`,
    headers: { authorization: `Bearer ${WRITER_TOKEN}` }
  });
  assert.equal(forbiddenResponse.statusCode, 403, forbiddenResponse.body);

  const { withConnection } = await import('../../src/db/client');
  const updatedDefinition = {
    name: 'Metrics payload',
    description: 'Schema auto-refreshed from registry',
    version: '1.1.0',
    metadata: { owner: 'data-platform' },
    fields: [
      {
        path: 'id',
        type: 'string',
        description: 'Primary identifier',
        required: true
      },
      {
        path: 'payload.timestamp',
        type: 'string',
        description: 'ISO-8601 timestamp',
        required: true
      },
      {
        path: 'payload.value',
        type: 'number',
        description: 'Observed measurement',
        required: false
      }
    ]
  };

  await withConnection((client) =>
    client.query(
      `UPDATE metastore_schema_registry
         SET definition = $2::jsonb,
             updated_at = NOW()
       WHERE schema_hash = $1`,
      [schemaDefinition.schemaHash, updatedDefinition]
    )
  );

  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const refreshedFetch = await app.inject({
    method: 'GET',
    url: `/schemas/${encodeURIComponent(schemaDefinition.schemaHash)}`,
    headers: { authorization: `Bearer ${READER_TOKEN}` }
  });
  assert.equal(refreshedFetch.statusCode, 200, refreshedFetch.body);
  const refreshedBody = refreshedFetch.json() as {
    cache: string;
    version?: string;
    fields: Array<{ path: string }>;
  };
  assert.equal(refreshedBody.cache, 'cache');
  assert.equal(refreshedBody.version, '1.1.0');
  const valueField = refreshedBody.fields.find((field) => field.path === 'payload.value');
  assert.ok(valueField, 'expected payload.value field after refresh');
}, { name: 'metastore-schema-registry' });
