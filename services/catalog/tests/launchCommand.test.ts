import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDockerRunCommand, parseDockerCommand } from '../src/launchCommand';

const multiline = [
  'docker run -d \\',
  '  --name example \\',
  '  -p 0:4173 \\',
  '  example/image:latest'
].join('\n');

const multilineWindows = [
  'docker run -d \\',
  '  --name example \\',
  '  -p 0:4173 \\',
  '  example/image:latest'
].join('\r\n');

const expected = ['run', '-d', '--name', 'example', '-p', '0:4173', 'example/image:latest'];

assert.deepEqual(parseDockerCommand(multiline), expected);
assert.deepEqual(parseDockerCommand(multilineWindows), expected);

assert.deepEqual(parseDockerCommand('docker'), []);
assert.strictEqual(parseDockerCommand(''), null);
assert.deepEqual(parseDockerCommand('docker run'), ['run']);

const withQuoted = "docker run -e FOO='some value'";
assert.deepEqual(parseDockerCommand(withQuoted), ['run', '-e', "FOO=some value"]);

const originalHostRoot = process.env.APPHUB_HOST_ROOT;

(() => {
  const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'apphub-host-root-hostmnt-'));
  const uniqueSegment = `watch-${Date.now().toString(36)}`;
  const absoluteDir = path.join('/Users', 'tester', uniqueSegment);
  const hostMntBase = path.join(hostRoot, 'host_mnt', 'Users', 'tester', uniqueSegment);
  mkdirSync(hostMntBase, { recursive: true });
  mkdirSync(path.join(hostMntBase, 'inbox'), { recursive: true });

  process.env.APPHUB_HOST_ROOT = hostRoot;

  try {
    const result = buildDockerRunCommand({
      repositoryId: 'example-repo',
      launchId: 'launch12345678',
      imageTag: 'example/image:latest',
      env: [
        { key: 'FILE_WATCH_ROOT', value: path.join(absoluteDir, 'inbox') }
      ],
      internalPort: 4173
    });

    const mountIndex = result.args.findIndex((token) => token === '-v');
    assert.notStrictEqual(mountIndex, -1);
    const mount = result.args[mountIndex + 1];
    const expectedSource = path.join(hostDir(hostRoot, absoluteDir), 'inbox');
    const expectedTarget = path.join(absoluteDir, 'inbox');
    assert.strictEqual(mount, `${expectedSource}:${expectedTarget}:rw`);
  } finally {
    if (typeof originalHostRoot === 'string') {
      process.env.APPHUB_HOST_ROOT = originalHostRoot;
    } else {
      delete process.env.APPHUB_HOST_ROOT;
    }
    rmSync(hostRoot, { recursive: true, force: true });
  }
})();

function hostDir(root: string, absolute: string): string {
  const normalized = absolute.startsWith('/') ? absolute.slice(1) : absolute;
  return path.join(root, 'host_mnt', ...normalized.split(path.sep));
}
