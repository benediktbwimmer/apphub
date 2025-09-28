/*
 * Ensures Node's built-in test runner exits even when lingering handles remain.
 * Load via `node --require ts-node/register --require ../../tests/helpers/node-test-force-exit.cjs --test ...`.
 */

if (!globalThis.__apphubNodeTestForceExitInstalled) {
  globalThis.__apphubNodeTestForceExitInstalled = true;

  const { after } = require('node:test');
  const { scheduleForcedExit } = require('./forceExit');

  after(() => {
    scheduleForcedExit({ name: process.env.APPHUB_TEST_SUITE_NAME ?? 'node:test suite' });
  });
}
