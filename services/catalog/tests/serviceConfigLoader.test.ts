import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearServiceConfigImports, loadServiceConfigurations } from '../src/serviceConfigLoader';

async function createTempConfig(manifestOverride?: Record<string, unknown>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-service-config-test-'));
  const manifestPath = path.join(dir, 'service-manifest.json');
  const configPath = path.join(dir, 'service-config.json');

  const manifest =
    manifestOverride ?? {
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
    assert.equal(result.placeholders.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})();

(async () => {
  const manifest = {
    services: [
      {
        slug: 'placeholder-service',
        displayName: 'Placeholder Service',
        kind: 'example',
        baseUrl: 'http://localhost:6000',
        env: [
          {
            key: 'ROOT_PATH',
            value: { $var: { name: 'ROOT_PATH', default: '/tmp/data', description: 'Base directory' } }
          }
        ]
      }
    ]
  };

  const { dir, configPath } = await createTempConfig(manifest);
  try {
    const result = await loadServiceConfigurations([configPath]);
    assert.equal(result.errors.length, 0, 'expected no errors when defaults provided');
    assert.equal(result.entries.length, 1);
    const service = result.entries[0];
    assert.deepEqual(service.env, [{ key: 'ROOT_PATH', value: '/tmp/data' }]);
    assert.equal(result.placeholders.length, 1);
    const placeholder = result.placeholders[0];
    assert.equal(placeholder.name, 'ROOT_PATH');
    assert.equal(placeholder.missing, false);
    assert.equal(placeholder.value, '/tmp/data');
    assert.equal(placeholder.required, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})();

(async () => {
  const manifest = {
    services: [
      {
        slug: 'needs-token',
        displayName: 'Needs Token',
        kind: 'example',
        baseUrl: 'http://localhost:6100',
        env: [{ key: 'API_TOKEN', value: '${API_TOKEN}' }]
      }
    ]
  };

  const { dir, configPath } = await createTempConfig(manifest);
  try {
    const result = await loadServiceConfigurations([configPath]);
    assert(result.errors.length >= 1, 'expected missing placeholder to produce an error');
    const messages = result.errors.map((entry) => entry.error.message);
    assert(messages.some((message) => /placeholder API_TOKEN/i.test(message)));
    assert.equal(result.placeholders.length, 1);
    const placeholder = result.placeholders[0];
    assert.equal(placeholder.name, 'API_TOKEN');
    assert.equal(placeholder.missing, true);
    assert(placeholder.required);
    assert.equal(placeholder.value, undefined);
    assert.equal(placeholder.occurrences.length, 1);
    const occurrence = placeholder.occurrences[0];
    assert.equal(occurrence.kind, 'service');
    if (occurrence.kind === 'service') {
      assert.equal(occurrence.serviceSlug, 'needs-token');
      assert.equal(occurrence.envKey, 'API_TOKEN');
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})();

(async () => {
  const { dir, configPath } = await createTempConfig();
  try {
    const configWithImports = {
      module: 'github.com/apphub/test-module',
      manifestPath: './service-manifest.json',
      imports: [
        {
          module: 'github.com/apphub/another-module',
          repo: 'https://example.com/another.git',
          commit: '0123456789abcdef0123456789abcdef01234567'
        }
      ]
    };
    await fs.writeFile(configPath, JSON.stringify(configWithImports, null, 2), 'utf8');

    const result = await clearServiceConfigImports([configPath]);
    assert.deepEqual(result.cleared, [configPath]);
    assert.equal(result.errors.length, 0);

    const updated = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
    assert.ok(!('imports' in updated), 'imports should be removed');
    assert.equal(updated.module, 'github.com/apphub/test-module');
    assert.equal(updated.manifestPath, './service-manifest.json');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})();
