import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadServiceConfigurations } from '../src/serviceConfigLoader';

async function createTempConfig() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-service-config-test-'));
  const manifestPath = path.join(dir, 'service-manifest.json');
  const configPath = path.join(dir, 'service-config.json');

  const manifest = {
    services: [
      {
        slug: 'example-service',
        displayName: 'Example Service',
        kind: 'example',
        baseUrl: 'http://localhost:5000',
        env: [
          { key: 'FOO', value: 'bar' },
          { key: 'BAZ', value: 'qux' }
        ]
      }
    ],
    networks: [
      {
        id: 'demo-network',
        name: 'Demo Network',
        description: 'Example network',
        repoUrl: 'https://example.com/demo-network.git',
        dockerfilePath: 'Dockerfile',
        env: [{ key: 'NETWORK_MODE', value: 'demo' }],
        services: [
          {
            serviceSlug: 'example-service',
            launchOrder: 1,
            waitForBuild: true,
            env: [{ key: 'SERVICE_TOKEN', value: 'secret' }],
            app: {
              id: 'example-service-app',
              name: 'Example Service App',
              description: 'Runtime app',
              repoUrl: 'https://example.com/example-service.git',
              dockerfilePath: 'Dockerfile',
              launchEnv: [{ key: 'APP_MODE', value: 'demo' }]
            }
          }
        ]
      }
    ]
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const serviceConfig = {
    module: 'github.com/apphub/test-module',
    manifestPath: './service-manifest.json'
  };

  await fs.writeFile(configPath, JSON.stringify(serviceConfig, null, 2), 'utf8');

  return { dir, manifestPath, configPath };
}

(async () => {
  const { dir, configPath } = await createTempConfig();
  try {
    const result = await loadServiceConfigurations([configPath]);

    assert.equal(result.entries.length, 1, 'expected one service entry');
    const service = result.entries[0];
    assert.equal(service.slug, 'example-service');
    assert.equal(service.env?.length, 2);
    assert.deepEqual(service.env, [
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' }
    ]);

    assert.equal(result.networks.length, 1, 'expected one service network');
    const network = result.networks[0];
    assert.equal(network.id, 'demo-network');
    assert.equal(network.services.length, 1);
    assert.equal(network.services[0]?.serviceSlug, 'example-service');
    assert.deepEqual(network.services[0]?.env, [{ key: 'SERVICE_TOKEN', value: 'secret' }]);
    assert.deepEqual(network.env, [{ key: 'NETWORK_MODE', value: 'demo' }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})();
