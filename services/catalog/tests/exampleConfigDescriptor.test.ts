import './setupTestEnv';
import assert from 'node:assert/strict';
import { previewServiceConfigImport } from '../src/serviceConfigLoader';

async function run() {
  const previousBootstrapFlag = process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP;
  process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP = '1';

  try {
    const preview = await previewServiceConfigImport({
      path: 'examples/environmental-observatory-event-driven',
      module: 'github.com/apphub/examples/environmental-observatory-event-driven'
    });

    assert.equal(preview.errors.length, 0, 'descriptor import should not report errors');
    assert(preview.bootstrap?.actions?.length, 'descriptor should expose bootstrap actions');

    const dashboard = preview.entries.find((entry) => entry.slug === 'observatory-dashboard');
    assert(dashboard, 'dashboard manifest should be present');
    const configEnv = dashboard?.env?.find((env) => env.key === 'OBSERVATORY_CONFIG_PATH');
    assert(configEnv, 'OBSERVATORY_CONFIG_PATH env should be present');
    assert.equal(
      configEnv?.value,
      'examples/environmental-observatory-event-driven/.generated/observatory-config.json',
      'descriptor should hydrate manifest config path'
    );

    const placeholder = preview.placeholders.find((entry) => entry.name === 'OBSERVATORY_DATA_ROOT');
    assert(placeholder, 'placeholder summary should include OBSERVATORY_DATA_ROOT');
    assert.equal(
      placeholder?.defaultValue,
      'examples/environmental-observatory-event-driven/data',
      'descriptor placeholder should expose default value'
    );
    assert.equal(
      placeholder?.value,
      'examples/environmental-observatory-event-driven/data',
      'descriptor placeholder should resolve to default value when not overridden'
    );
  } finally {
    if (previousBootstrapFlag === undefined) {
      delete process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP;
    } else {
      process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP = previousBootstrapFlag;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
