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
  const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'apphub-host-root-'));
  const uniqueSegment = `apphub-start-${Date.now().toString(36)}`;
  const fallbackDir = path.join(hostRoot, uniqueSegment);
  mkdirSync(fallbackDir, { recursive: true });

  process.env.APPHUB_HOST_ROOT = hostRoot;

  const startPath = `/${uniqueSegment}`;
  try {
    const result = buildDockerRunCommand({
      repositoryId: 'example-repo',
      launchId: 'launch12345678',
      imageTag: 'example/image:latest',
      env: [
        { key: 'START_PATH', value: startPath }
      ],
      internalPort: 4173
    });

    const mountIndex = result.args.findIndex((token, index) => {
      if (token !== '-v') {
        return false;
      }
      const mount = result.args[index + 1];
      return mount === `${startPath}:${startPath}:ro`;
    });

    assert.notStrictEqual(mountIndex, -1);
  } finally {
    if (typeof originalHostRoot === 'string') {
      process.env.APPHUB_HOST_ROOT = originalHostRoot;
    } else {
      delete process.env.APPHUB_HOST_ROOT;
    }
    rmSync(hostRoot, { recursive: true, force: true });
  }
})();

(() => {
  const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'apphub-host-root-hostmnt-'));
  const uniqueSegment = `apphub-desktop-${Date.now().toString(36)}`;
  const hostMntBase = path.join(hostRoot, 'host_mnt');
  const macPath = path.join(hostMntBase, 'Users', 'tester', uniqueSegment);
  mkdirSync(macPath, { recursive: true });

  process.env.APPHUB_HOST_ROOT = hostRoot;
  const startPath = `/Users/tester/${uniqueSegment}`;

  try {
    const result = buildDockerRunCommand({
      repositoryId: 'example-repo',
      launchId: 'launch87654321',
      imageTag: 'example/image:latest',
      env: [
        { key: 'START_PATH', value: startPath }
      ],
      internalPort: 4173
    });

    const mountIndex = result.args.findIndex((token, index) => {
      if (token !== '-v') {
        return false;
      }
      const mount = result.args[index + 1];
      return mount === `${startPath}:${startPath}:ro`;
    });

    assert.notStrictEqual(mountIndex, -1);
  } finally {
    if (typeof originalHostRoot === 'string') {
      process.env.APPHUB_HOST_ROOT = originalHostRoot;
    } else {
      delete process.env.APPHUB_HOST_ROOT;
    }
    rmSync(hostRoot, { recursive: true, force: true });
  }
})();
