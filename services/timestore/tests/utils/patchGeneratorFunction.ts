import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('generator-function');
const loaded = require(modulePath);

if (typeof loaded !== 'function' && loaded && typeof loaded.default === 'function') {
  require.cache[modulePath]!.exports = loaded.default;
}
