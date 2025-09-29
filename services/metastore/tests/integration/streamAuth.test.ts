import './testEnv';

import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { runE2E } from '@apphub/test-helpers';

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

type TestContext = {
  app: FastifyInstance;
  dataDir: string;
  postgres: EmbeddedPostgres;
};

async function setupMetastore(): Promise<TestContext> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'metastore-auth-'));
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
  process.env.APPHUB_METRICS_ENABLED = '0';
  process.env.METASTORE_FILESTORE_SYNC_ENABLED = 'false';
  process.env.FILESTORE_REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.METASTORE_FILESTORE_NAMESPACE = 'filestore-auth';
  process.env.APPHUB_METASTORE_TOKENS = JSON.stringify([
    {
      token: 'read-token',
      subject: 'reader@apphub.dev',
      scopes: ['metastore:read'],
      namespaces: '*',
      kind: 'user'
    },
    {
      token: 'write-token',
      subject: 'writer@apphub.dev',
      scopes: ['metastore:write'],
      namespaces: '*',
      kind: 'user'
    }
  ]);

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  const { buildApp } = await import('../../src/app');
  const { app } = await buildApp();
  await app.ready();

  return { app, dataDir, postgres } satisfies TestContext;
}

runE2E(async ({ registerCleanup }) => {
  const envSnapshot = snapshotEnv([
    'DATABASE_URL',
    'APPHUB_AUTH_DISABLED',
    'APPHUB_METRICS_ENABLED',
    'METASTORE_FILESTORE_SYNC_ENABLED',
    'FILESTORE_REDIS_URL',
    'METASTORE_FILESTORE_NAMESPACE',
    'APPHUB_METASTORE_TOKENS',
    'NODE_ENV'
  ]);
  registerCleanup(async () => {
    restoreEnv(envSnapshot);
  });

  const { app, dataDir, postgres } = await setupMetastore();

  registerCleanup(async () => {
    await app.close();
  });

  registerCleanup(async () => {
    await postgres.stop();
  });

  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/stream/records'
  });
  assert.equal(unauthorized.statusCode, 401);

  const forbidden = await app.inject({
    method: 'GET',
    url: '/stream/records',
    headers: {
      Authorization: 'Bearer write-token'
    }
  });
  assert.equal(forbidden.statusCode, 403);
});
