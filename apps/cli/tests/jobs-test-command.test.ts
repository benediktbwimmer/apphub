import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createTempDir } from './helpers';
import { loadOrScaffoldBundle, buildBundle } from '../src/lib/bundle';
import { executeBundle } from '../src/lib/harness';
import { writeJsonFile } from '../src/lib/json';
import type { JobBundleManifest, JsonValue } from '../src/types';

test('executeBundle runs the generated handler', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-run-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const { context } = await loadOrScaffoldBundle(dir, {});
  await buildBundle(context);

  const parameters: JsonValue = { hello: 'world' };
  const execution = await executeBundle(context, parameters);
  assert.equal(execution.result.status ?? 'succeeded', 'succeeded');
  const jobResult = execution.result.result as { echoed?: { hello?: string } } | null;
  assert.equal(jobResult?.echoed?.hello, 'world');
});

test('executeBundle runs a python handler', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-python-run-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const initial = await loadOrScaffoldBundle(dir, {});
  const updatedManifest: JobBundleManifest = {
    ...initial.context.manifest,
    runtime: 'python',
    pythonEntry: 'src/main.py'
  };
  (updatedManifest as Record<string, unknown>).entry = undefined;
  await writeJsonFile(initial.context.manifestPath, updatedManifest);

  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'src', 'main.py'),
    [
      "async def handler(context):",
      "    context.logger('python-handler', {'parameters': context.parameters})",
      "    await context.update({'metrics': {'count': 1}})",
      "    return {'status': 'succeeded', 'result': {'echoed': context.parameters}}",
      ''
    ].join('\n'),
    'utf8'
  );

  const { context } = await loadOrScaffoldBundle(dir, {});
  await buildBundle(context);

  const parameters: JsonValue = { greet: 'bonjour' };
  const execution = await executeBundle(context, parameters);
  assert.equal(execution.result.status ?? 'succeeded', 'succeeded');
  const jobResult = execution.result.result as { echoed?: { greet?: string } } | null;
  assert.equal(jobResult?.echoed?.greet, 'bonjour');
  assert(execution.runContext.logs.some((line) => line.includes('python-handler')));
});

test('executeBundle surfaces stack traces when the handler fails', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-run-fail-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const { context } = await loadOrScaffoldBundle(dir, {});
  await buildBundle(context);

  const entryFile = context.manifest.entry ?? 'dist/index.mjs';
  const entryPath = path.join(context.bundleDir, entryFile);
  await writeFile(
    entryPath,
    [
      "export default () => {",
      "  throw new Error('intentional failure from test');",
      "};",
      ''
    ].join('\n'),
    'utf8'
  );

  try {
    await executeBundle(context, {});
    assert.fail('expected executeBundle to throw');
  } catch (err) {
    assert(err instanceof Error);
    const stack = err.stack ?? '';
    assert.match(stack, /intentional failure from test/);
    const runContext = (err as Error & { runContext?: { logs: string[] } }).runContext;
    assert(runContext, 'expected error to expose runContext');
    assert(runContext.logs.some((line) => line.includes('intentional failure from test')));
  }
});
