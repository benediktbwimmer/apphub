import './testEnv';

import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { runE2E } from '@apphub/test-helpers';

const ADMIN_TOKEN = 'metastore-admin-token';
const LIMITED_TOKEN = 'metastore-analytics-token';
const WRITE_ONLY_TOKEN = 'metastore-writer-token';

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
  const dataDir = await mkdtemp(path.join(tmpdir(), 'metastore-pg-'));
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

  const tokens = [
    {
      token: ADMIN_TOKEN,
      subject: 'admin',
      scopes: ['metastore:read', 'metastore:write', 'metastore:delete'],
      namespaces: '*',
      kind: 'service'
    },
    {
      token: LIMITED_TOKEN,
      subject: 'analytics-reader',
      scopes: ['metastore:read'],
      namespaces: ['analytics'],
      kind: 'user'
    },
    {
      token: WRITE_ONLY_TOKEN,
      subject: 'writer',
      scopes: ['metastore:write'],
      namespaces: '*',
      kind: 'service'
    }
  ];

  process.env.APPHUB_METASTORE_TOKENS = JSON.stringify(tokens);

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
    'NODE_ENV'
  ]);

  registerCleanup(async () => {
    restoreEnv(envSnapshot);
  });

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

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

  async function createRecord(payload: Record<string, unknown>): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/records',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  await createRecord({
    namespace: 'analytics',
    key: 'dashboards',
    metadata: { status: 'active' },
    owner: 'data-team@apphub.dev'
  });

  await createRecord({
    namespace: 'analytics',
    key: 'pipeline',
    metadata: { status: 'paused' },
    owner: 'platform-team@apphub.dev'
  });

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: '/records/analytics/pipeline',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: {}
  });
  assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);

  await createRecord({
    namespace: 'operations',
    key: 'runbook',
    metadata: { status: 'published' },
    owner: 'ops-team@apphub.dev'
  });

  await createRecord({
    namespace: 'operations',
    key: 'rotation',
    metadata: { status: 'published' },
    owner: 'ops-team@apphub.dev'
  });

  await createRecord({
    namespace: 'observability',
    key: 'dashboards',
    metadata: { status: 'active' },
    owner: 'observability@apphub.dev'
  });

  const listResponse = await app.inject({
    method: 'GET',
    url: '/namespaces?limit=10',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  assert.equal(listResponse.statusCode, 200, listResponse.body);

  const body = listResponse.json() as {
    pagination: { total: number; limit: number; offset: number; nextOffset?: number };
    namespaces: Array<{
      name: string;
      totalRecords: number;
      deletedRecords: number;
      lastUpdatedAt: string | null;
      ownerCounts?: Array<{ owner: string; count: number }>;
    }>;
  };

  assert.equal(body.pagination.total, 3);
  assert.equal(body.pagination.limit, 10);
  assert.equal(body.pagination.offset, 0);
  assert.equal(body.namespaces.length, 3);
  assert.equal(body.pagination.nextOffset, undefined);

  const analytics = body.namespaces.find((entry) => entry.name === 'analytics');
  assert.ok(analytics);
  assert.equal(analytics?.totalRecords, 2);
  assert.equal(analytics?.deletedRecords, 1);
  assert.equal(Array.isArray(analytics?.ownerCounts), true);
  assert.equal(analytics?.ownerCounts?.length, 1);
  assert.equal(analytics?.ownerCounts?.[0]?.owner, 'data-team@apphub.dev');
  assert.equal(analytics?.ownerCounts?.[0]?.count, 1);
  assert.equal(typeof analytics?.lastUpdatedAt, 'string');

  const operations = body.namespaces.find((entry) => entry.name === 'operations');
  assert.ok(operations);
  assert.equal(operations?.totalRecords, 2);
  assert.equal(operations?.deletedRecords, 0);
  assert.equal(operations?.ownerCounts?.length, 1);
  assert.equal(operations?.ownerCounts?.[0]?.owner, 'ops-team@apphub.dev');
  assert.equal(operations?.ownerCounts?.[0]?.count, 2);

  const prefixResponse = await app.inject({
    method: 'GET',
    url: '/namespaces?prefix=ope',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  assert.equal(prefixResponse.statusCode, 200, prefixResponse.body);
  const prefixBody = prefixResponse.json() as { namespaces: Array<{ name: string }> };
  assert.equal(prefixBody.namespaces.length, 1);
  assert.equal(prefixBody.namespaces[0]?.name, 'operations');

  const limitedResponse = await app.inject({
    method: 'GET',
    url: '/namespaces',
    headers: { authorization: `Bearer ${LIMITED_TOKEN}` }
  });
  assert.equal(limitedResponse.statusCode, 200, limitedResponse.body);
  const limitedBody = limitedResponse.json() as { namespaces: Array<{ name: string }> };
  assert.equal(limitedBody.namespaces.length, 1);
  assert.equal(limitedBody.namespaces[0]?.name, 'analytics');

  const forbiddenResponse = await app.inject({
    method: 'GET',
    url: '/namespaces',
    headers: { authorization: `Bearer ${WRITE_ONLY_TOKEN}` }
  });
  assert.equal(forbiddenResponse.statusCode, 403, forbiddenResponse.body);

  const metricsResponse = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  assert.equal(metricsResponse.statusCode, 200, metricsResponse.body);
  const metricsBody = metricsResponse.body;
  assert.ok(metricsBody.includes('metastore_namespace_records{namespace="analytics"} 2'));
  assert.ok(metricsBody.includes('metastore_namespace_deleted_records{namespace="analytics"} 1'));
  assert.ok(metricsBody.includes('metastore_namespace_records{namespace="operations"} 2'));
});
