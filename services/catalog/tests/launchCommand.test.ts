import assert from 'node:assert/strict';
import { parseDockerCommand } from '../src/launchCommand';

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
