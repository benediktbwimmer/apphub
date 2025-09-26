import './setupTestEnv';
import assert from 'node:assert/strict';
import { previewServiceConfigImport } from '../src/serviceConfigLoader';
import { resolvePortFromManifestEnv } from '../src/serviceRegistry';

async function run() {
  const preview = await previewServiceConfigImport({
    path: 'examples/environmental-observatory/service-manifests',
    configPath: 'service-config.json',
    module: 'github.com/apphub/examples/environmental-observatory'
  });

  assert(preview.entries.length > 0, 'service manifest entries should be discovered');

  const entry = preview.entries[0];
  assert(entry.env, 'manifest env vars should be resolved');

  const env = entry.env;
  const port = resolvePortFromManifestEnv(env);
  assert.equal(port, 4310, 'resolved port should match manifest PORT env');

  const token = env.find((item) => item.key === 'CATALOG_API_TOKEN');
  assert(token, 'placeholder-backed env should be present');
  assert.equal(
    token?.value,
    'dev-token',
    'placeholder-backed env should resolve to default value when not overridden'
  );

  const watchRoot = env.find((item) => item.key === 'FILE_WATCH_ROOT');
  assert(watchRoot, 'FILE_WATCH_ROOT should be present');
  assert.equal(
    watchRoot?.value,
    'examples/environmental-observatory/data/inbox',
    'placeholder default should propagate into resolved env metadata'
  );

  const placeholderPort = resolvePortFromManifestEnv([
    {
      key: 'PORT',
      value: {
        $var: {
          name: 'PORT',
          default: '5173'
        }
      }
    }
  ]);
  assert.equal(placeholderPort, 5173, 'placeholder metadata should fall back to default port value');

  const previewWithRequire = await previewServiceConfigImport({
    path: 'examples/environmental-observatory/service-manifests',
    configPath: 'service-config.json',
    module: 'github.com/apphub/examples/environmental-observatory',
    requirePlaceholderValues: true
  });
  const optionalPlaceholder = previewWithRequire.placeholders.find(
    (entry) => entry.name === 'TIMESTORE_STORAGE_TARGET_ID'
  );
  assert(optionalPlaceholder, 'optional placeholder should be reported in preview');
  assert.equal(
    optionalPlaceholder?.missing,
    false,
    'optional placeholders with defaults should not require explicit values'
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
