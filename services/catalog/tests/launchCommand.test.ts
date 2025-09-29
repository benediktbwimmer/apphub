import assert from 'node:assert/strict';
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

const dockerCommand = buildDockerRunCommand({
  repositoryId: 'example-repo',
  launchId: 'launch12345678',
  imageTag: 'example/image:latest',
  env: [
    { key: 'FILE_WATCH_ROOT', value: '/Users/tester/watch/inbox' }
  ],
  internalPort: 4173
});

assert.strictEqual(
  dockerCommand.args.includes('-v'),
  false,
  'launch command should not inject host volume mounts'
);
