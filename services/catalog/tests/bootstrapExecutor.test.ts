import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
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
  assert(queries.length === 1, 'expected filestore backend upsert to run');
  assert(Array.isArray(queries[0]?.params), 'expected query parameters');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
