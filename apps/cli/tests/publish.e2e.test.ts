import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { AddressInfo } from 'node:net';
import { createTempDir } from './helpers';
import { loadOrScaffoldBundle, packageBundle } from '../src/lib/bundle';
import { writeJsonFile } from '../src/lib/json';

function startMockRegistry(): Promise<{
  url: string;
  requests: unknown[];
  close(): Promise<void>;
}> {
  const requests: unknown[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/job-bundles') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          requests.push(parsed);
        } catch (err) {
          requests.push({ error: err });
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { ok: true } }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        async close() {
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          });
        }
      });
    });
  });
}

test('publish flow uploads tarball payload', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-publish-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const { context } = await loadOrScaffoldBundle(dir, {});
  context.manifest.capabilities = ['fs'];
  await writeJsonFile(context.manifestPath, context.manifest);

  const packageResult = await packageBundle(context, { force: true });

  const registry = await startMockRegistry();
  t.after(async () => {
    await registry.close();
  });

  const artifactBuffer = await readFile(packageResult.tarballPath);
  const payload = {
    slug: context.config.slug,
    version: context.manifest.version,
    manifest: context.manifest,
    capabilityFlags: ['fs', 'custom-flag'],
    description: context.manifest.description ?? undefined,
    displayName: context.manifest.name,
    metadata: context.manifest.metadata ?? undefined,
    artifact: {
      data: artifactBuffer.toString('base64'),
      filename: path.basename(packageResult.tarballPath),
      contentType: 'application/gzip',
      checksum: packageResult.checksum
    }
  };

  const response = await fetch(`${registry.url}/job-bundles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 201);

  assert.equal(registry.requests.length, 1);
  const recorded = registry.requests[0] as typeof payload;
  assert.equal(recorded.slug, payload.slug);
  assert.equal(recorded.version, payload.version);
  assert.deepEqual(new Set(recorded.capabilityFlags), new Set(payload.capabilityFlags));
  const uploadedBuffer = Buffer.from(recorded.artifact.data, 'base64');
  assert.deepEqual(uploadedBuffer, artifactBuffer);
});

test('publish flow uploads python tarball', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-publish-python-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const initial = await loadOrScaffoldBundle(dir, {});
  const pythonManifest = {
    ...initial.context.manifest,
    runtime: 'python',
    pythonEntry: 'src/main.py',
    capabilities: ['python-net']
  };
  (pythonManifest as Record<string, unknown>).entry = undefined;
  await writeJsonFile(initial.context.manifestPath, pythonManifest);

  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'src', 'main.py'),
    [
      "async def handler(context):",
      "    return {'status': 'succeeded', 'result': {'echoed': context.parameters}}",
      ''
    ].join('\n'),
    'utf8'
  );

  const { context } = await loadOrScaffoldBundle(dir, {});
  const packageResult = await packageBundle(context, { force: true });

  const registry = await startMockRegistry();
  t.after(async () => {
    await registry.close();
  });

  const artifactBuffer = await readFile(packageResult.tarballPath);
  const payload = {
    slug: context.config.slug,
    version: context.manifest.version,
    manifest: context.manifest,
    capabilityFlags: ['python-net'],
    description: context.manifest.description ?? undefined,
    displayName: context.manifest.name,
    metadata: context.manifest.metadata ?? undefined,
    artifact: {
      data: artifactBuffer.toString('base64'),
      filename: path.basename(packageResult.tarballPath),
      contentType: 'application/gzip',
      checksum: packageResult.checksum
    }
  };

  const response = await fetch(`${registry.url}/job-bundles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 201);

  const recorded = registry.requests.at(-1) as typeof payload;
  assert.equal(recorded.manifest.runtime, 'python');
  assert.equal(recorded.manifest.pythonEntry, 'src/main.py');
  assert.deepEqual(new Set(recorded.capabilityFlags), new Set(payload.capabilityFlags));
  const uploadedBuffer = Buffer.from(recorded.artifact.data, 'base64');
  assert.deepEqual(uploadedBuffer, artifactBuffer);
});
