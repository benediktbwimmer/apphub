import './tests/setupTestEnv';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';

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

async function startDatabase() {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'preview-pg-'));
  const port = await findAvailablePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '8';
  return { postgres, dataRoot };
}

async function main() {
  const { postgres, dataRoot } = await startDatabase();
  const [{ ensureDatabase }, { buildServer }] = await Promise.all([
    import('./src/db/init'),
    import('./src/server')
  ]);

  await ensureDatabase();

  const snippet = [
    'from pydantic import BaseModel',
    '',
    '',
    'class GreetingInput(BaseModel):',
    '  name: str',
    '',
    '',
    'class GreetingOutput(BaseModel):',
    '  greeting: str',
    '',
    '',
    'def build_greeting(payload: GreetingInput) -> GreetingOutput:',
    "  return GreetingOutput(greeting=f'Hello {payload.name}!')",
    ''
  ].join('\n');

  const token = 'jobs-e2e-operator-token';
  const app = await buildServer();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/jobs/python-snippet/preview',
      headers: { Authorization: `Bearer ${token}` },
      payload: { snippet }
    });
    console.log('status', response.statusCode);
    console.log('payload', response.payload);
  } finally {
    await app.close();
    await postgres.stop();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
