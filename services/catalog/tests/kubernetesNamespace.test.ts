import './setupTestEnv';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyManifest,
  type KubectlResult,
  type RunKubectlOptions,
  __setKubectlRunnerForTests,
  __resetKubectlTestState
} from '../src/kubernetes/kubectl';

test('applyManifest creates missing namespace before applying manifest', async (t) => {
  __resetKubectlTestState();
  const calls: Array<string[]> = [];

  const runner = async (args: string[], options: RunKubectlOptions = {}): Promise<KubectlResult> => {
    calls.push([...args]);
    if (args[0] === 'get' && args[1] === 'namespace') {
      return { exitCode: 1, stdout: '', stderr: 'namespaces "apphub" not found' };
    }
    if (args[0] === 'create' && args[1] === 'namespace') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'apply') {
      assert.equal(options.stdin === undefined, false, 'apply should receive manifest payload');
      const payload = JSON.parse(String(options.stdin));
      assert.equal(payload.metadata?.name, 'demo-config');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  __setKubectlRunnerForTests(runner);
  t.after(__resetKubectlTestState);

  const manifest = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: 'demo-config'
    }
  } satisfies Record<string, unknown>;

  const result = await applyManifest(manifest, 'apphub');
  assert.equal(result.exitCode, 0);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['get', 'namespace', 'apphub']);
  assert.deepEqual(calls[1], ['create', 'namespace', 'apphub']);
  assert.deepEqual(calls[2], ['apply', '-f', '-', '--namespace', 'apphub']);
});
