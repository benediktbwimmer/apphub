import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeBootstrapPlan, type BootstrapPlanSpec } from '../src/bootstrap';

async function run(): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-exec-'));
  const plan: BootstrapPlanSpec = {
    actions: [
      {
        type: 'ensureDirectories',
        directories: [
          '{{ paths.workspaceRoot }}/data/inbox',
          '{{ paths.workspaceRoot }}/data/archive'
        ]
      },
      {
        type: 'setEnvDefaults',
        values: {
          TEST_PLACEHOLDER: 'computed-value'
        }
      },
      {
        type: 'writeJsonFile',
        path: '{{ paths.workspaceRoot }}/config.json',
        content: {
          testValue: '{{ placeholders.TEST_PLACEHOLDER }}',
          numberValue: '{{ placeholders.NUMERIC | number }}',
          nullValue: '{{ placeholders.OPTIONAL | default(null) }}'
        }
      },
      {
        type: 'ensureFilestoreBackend',
        mountKey: 'test-backend',
        backend: {
          kind: 'local',
          rootPath: '{{ paths.workspaceRoot }}/filestore'
        },
        assign: {
          placeholders: {
            NUMERIC: '{{ outputs.lastFilestoreBackendId | number }}'
          }
        }
      }
    ]
  };

  const queries: Array<{ text: string; params: unknown[] }> = [];
  const bootstrapResult = await executeBootstrapPlan({
    moduleId: 'test/module',
    plan,
    placeholders: new Map([
      ['NUMERIC', '7'],
      ['OPTIONAL', '']
    ]),
    variables: { NUMERIC: '7', OPTIONAL: '' },
    workspaceRoot,
    poolFactory: () => ({
      query: async (text, params) => {
        queries.push({ text, params });
        return { rows: [{ id: 99 }] };
      },
      end: async () => undefined
    })
  });

  for (const relative of ['data/inbox', 'data/archive']) {
    const stats = await stat(path.join(workspaceRoot, relative));
    assert(stats.isDirectory(), `expected directory ${relative}`);
  }

  const configPath = path.join(workspaceRoot, 'config.json');
  const configContents = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(configContents) as {
    testValue: string;
    numberValue: number;
    nullValue: unknown;
  };
  assert.equal(parsed.testValue, 'computed-value');
  assert.equal(parsed.numberValue, 7);
  assert.equal(parsed.nullValue, null);

  assert.equal(bootstrapResult.placeholders.get('TEST_PLACEHOLDER'), 'computed-value');
  assert.equal(bootstrapResult.placeholders.get('NUMERIC'), '99');
  assert(queries.length === 2, 'expected filestore backend queries to run');
  assert(Array.isArray(queries[1]?.params), 'expected query parameters');
  assert.equal(queries[1]?.params?.[1], path.join(workspaceRoot, 'filestore'));

  const originalHostRoot = process.env.APPHUB_HOST_ROOT;
  const hostRoot = path.join(workspaceRoot, 'host-root');
  await mkdir(hostRoot, { recursive: true });
  process.env.APPHUB_HOST_ROOT = hostRoot;

  const hostQueries: Array<{ text: string; params: unknown[] }> = [];
  const externalRoot = '/Users/apphub/example/observatory';
  await executeBootstrapPlan({
    moduleId: 'test/module',
    plan: {
      actions: [
        {
          type: 'ensureFilestoreBackend',
          mountKey: 'host-mapped',
          backend: {
            kind: 'local',
            rootPath: externalRoot
          }
        }
      ]
    },
    placeholders: new Map(),
    variables: {},
    workspaceRoot,
    poolFactory: () => ({
      query: async (text, params) => {
        hostQueries.push({ text, params });
        return { rows: [{ id: 101 }] };
      },
      end: async () => undefined
    })
  });

  const absoluteExternalRoot = path.resolve(externalRoot);
  let expectedRootPath = absoluteExternalRoot;
  const relativeFromRoot = path.relative('/', absoluteExternalRoot);
  if (relativeFromRoot && !relativeFromRoot.startsWith('..')) {
    expectedRootPath = path.join(hostRoot, relativeFromRoot);
  }
  assert(hostQueries.length === 2, 'expected host-mapped backend queries to run');
  assert(Array.isArray(hostQueries[1]?.params), 'expected host-mapped query parameters');
  assert.equal(hostQueries[1]?.params?.[1], expectedRootPath);
  const mappedStats = await stat(expectedRootPath);
  assert(mappedStats.isDirectory(), 'expected host-mapped directory to exist');

  if (originalHostRoot === undefined) {
    delete process.env.APPHUB_HOST_ROOT;
  } else {
    process.env.APPHUB_HOST_ROOT = originalHostRoot;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
