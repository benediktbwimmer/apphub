import assert from 'node:assert/strict';
import './setupTestEnv';
import { buildCodexContextFiles } from '../src/ai/contextFiles';
import type { AiBundleContext } from '../src/ai/bundleContext';

const sampleBundle: AiBundleContext = {
  slug: 'demo-bundle',
  version: '1.0.0',
  entryPoint: 'src/index.js',
  manifest: {
    name: 'demo-bundle',
    version: '1.0.0',
    entry: 'src/index.js',
    capabilities: ['fs.read']
  },
  manifestPath: 'manifest.json',
  capabilityFlags: ['fs.read'],
  metadata: null,
  description: 'Sample bundle for tests',
  displayName: 'Demo bundle',
  files: [
    {
      path: 'src/index.js',
      contents: "module.exports = () => 'ok';",
      encoding: 'utf8'
    },
    {
      path: 'assets/logo.png',
      contents: 'SGVsbG8=',
      encoding: 'base64'
    }
  ],
  jobSlugs: ['demo-job']
};

(async function run() {
  const files = buildCodexContextFiles({
    mode: 'job',
    jobs: [
      {
        slug: 'demo-job',
        name: 'Demo job',
        type: 'batch',
        version: 1,
        entryPoint: 'bundle:demo-bundle@1.0.0',
        timeoutMs: null,
        retryPolicy: null,
        parametersSchema: {},
        defaultParameters: {},
        outputSchema: {},
        metadata: null,
        registryRef: null
      }
    ],
    services: [],
    workflows: [],
    bundles: [sampleBundle]
  });

  const bundleIndex = files.find((file) => file.path === 'context/bundles/index.json');
  assert.ok(bundleIndex, 'bundle index file missing');
  const indexPayload = JSON.parse(bundleIndex!.contents);
  assert.equal(indexPayload.length, 1);
  assert.equal(indexPayload[0].slug, 'demo-bundle');
  assert.deepEqual(indexPayload[0].capabilityFlags, ['fs.read']);

  const manifestFile = files.find((file) => file.path === 'context/bundles/demo-bundle/1.0.0/manifest.json');
  assert.ok(manifestFile, 'bundle manifest missing');
  const manifestPayload = JSON.parse(manifestFile!.contents);
  assert.equal(manifestPayload.entry, 'src/index.js');

  const readmeFile = files.find((file) => file.path === 'context/bundles/README.md');
  assert.ok(readmeFile);
  assert.ok(readmeFile!.contents.includes('# Bundle Catalog Overview'));

  const textFile = files.find((file) => file.path === 'context/bundles/demo-bundle/1.0.0/files/src/index.js');
  assert.ok(textFile);
  assert.ok(textFile!.contents.endsWith('\n'), 'text bundle file should end with a newline');
  assert.ok(textFile!.contents.includes("module.exports = () => 'ok';"));

  const binaryFile = files.find((file) => file.path === 'context/bundles/demo-bundle/1.0.0/files/assets/logo.png.base64');
  assert.ok(binaryFile);
  assert.ok(binaryFile!.contents.endsWith('\n'), 'binary bundle file should end with a newline');

  const fileIndex = files.find((file) => file.path === 'context/bundles/demo-bundle/1.0.0/files/index.json');
  assert.ok(fileIndex);
  const fileIndexPayload = JSON.parse(fileIndex!.contents) as Array<{
    path: string;
    encoding: 'utf8' | 'base64';
    executable: boolean;
    contextPath: string;
  }>;
  assert.deepEqual(fileIndexPayload, [
    {
      path: 'src/index.js',
      encoding: 'utf8',
      executable: false,
      contextPath: 'context/bundles/demo-bundle/1.0.0/files/src/index.js'
    },
    {
      path: 'assets/logo.png',
      encoding: 'base64',
      executable: false,
      contextPath: 'context/bundles/demo-bundle/1.0.0/files/assets/logo.png.base64'
    }
  ]);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
