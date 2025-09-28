import './setupTestEnv';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewServiceConfigImport } from '../src/serviceConfigLoader';

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-docker-manifest-'));
  const previousOverrides = process.env.APPHUB_SERVICE_IMAGE_OVERRIDES;
  try {
    const configPath = path.join(tempDir, 'service-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          module: 'example/docker',
          services: [
            {
              slug: 'docker-service',
              displayName: 'Docker Service',
              kind: 'api',
              baseUrl: 'https://docker.example',
              capabilities: ['http']
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    );

    process.env.APPHUB_SERVICE_IMAGE_OVERRIDES = JSON.stringify({
      'example/service-manifest:latest': {
        root: tempDir,
        reference: 'sha256:testdigest'
      }
    });

    const preview = await previewServiceConfigImport({
      image: 'example/service-manifest:latest',
      module: 'example/docker',
      configPath: '/service-config.json'
    });

    assert.equal(preview.moduleId, 'example/docker');
    assert.equal(preview.errors.length, 0, 'expected no manifest load errors');
    assert.equal(preview.entries.length, 1, 'expected one service entry');
    const entry = preview.entries[0];
    assert.equal(entry.slug, 'docker-service');
    assert(entry.sources.some((source) => source.startsWith('image:example/service-manifest:latest')));
    assert.equal(preview.resolvedCommit, 'sha256:testdigest');
  } finally {
    if (previousOverrides === undefined) {
      delete process.env.APPHUB_SERVICE_IMAGE_OVERRIDES;
    } else {
      process.env.APPHUB_SERVICE_IMAGE_OVERRIDES = previousOverrides;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
