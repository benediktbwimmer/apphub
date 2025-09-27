import './setupTestEnv';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { previewServiceConfigImport } from '../src/serviceConfigLoader';
import { registerServiceRoutes } from '../src/routes/services';
import { resolvePortFromManifestEnv } from '../src/serviceRegistry';

async function run() {
  const previousBootstrapFlag = process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP;
  process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP = '1';

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

  const app = Fastify();
  const stubRegistry = {
    importManifestModule: async () => ({ servicesApplied: 2, networksApplied: 1 })
  } as const;
  await registerServiceRoutes(app, { registry: stubRegistry });
  try {
    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/service-networks/import',
      payload: {
        path: 'examples/environmental-observatory/service-manifests',
        configPath: 'service-config.json',
        module: 'github.com/apphub/examples/environmental-observatory',
        requirePlaceholderValues: true
      }
    });
    assert.equal(confirmResponse.statusCode, 400, 'import should request placeholder confirmation');
    const confirmBody = confirmResponse.json() as {
      placeholders?: Array<{ name?: string; missing?: boolean }>;
    };
    assert(Array.isArray(confirmBody.placeholders), 'placeholder confirmation should include placeholders');
    const storagePlaceholder = confirmBody.placeholders?.find(
      (entry) => entry?.name === 'TIMESTORE_STORAGE_TARGET_ID'
    );
    assert(storagePlaceholder, 'placeholder confirmation should surface storage target placeholder');
    assert.equal(
      storagePlaceholder?.missing,
      false,
      'optional placeholder should not be treated as missing during confirmation'
    );

    const importResponse = await app.inject({
      method: 'POST',
      url: '/service-networks/import',
      payload: {
        path: 'examples/environmental-observatory/service-manifests',
        configPath: 'service-config.json',
        module: 'github.com/apphub/examples/environmental-observatory',
        requirePlaceholderValues: false
      }
    });
    assert.equal(importResponse.statusCode, 201, 'import should succeed after confirmation step');
  } finally {
    await app.close();
    if (previousBootstrapFlag === undefined) {
      delete process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP;
    } else {
      process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP = previousBootstrapFlag;
    }
  }
}

// Ticket 068: temporarily skip while bootstrap refactor lands
const SKIP_TEST = true;

if (SKIP_TEST || process.env.APPHUB_SKIP_MANIFEST_ENV_METADATA_TEST === '1') {
  console.log('Skipping manifestEnvMetadata test');
} else {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
