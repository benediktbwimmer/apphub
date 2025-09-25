import './setupTestEnv';
import assert from 'node:assert/strict';
import type { JsonValue } from '../src/db/types';

async function run() {
  const { mergeServiceMetadata, coerceServiceMetadata } = await import('../src/serviceMetadata');
  const { serviceRegistrationSchema, servicePatchSchema } = await import('../src/routes/services');

  const registrationPayload = {
    slug: 'example-service',
    displayName: 'Example Service',
    kind: 'http',
    baseUrl: 'https://example.local',
    metadata: {
      manifest: {
        source: 'services/example.json',
        openapiPath: '/openapi.yaml'
      },
      runtime: {
        repositoryId: 'example-app',
        instanceUrl: 'https://runtime.example.local'
      },
      notes: 'Handles example workflows.'
    }
  };

  const parsedRegistration = serviceRegistrationSchema.parse(registrationPayload);
  assert.equal(parsedRegistration.metadata?.manifest?.openapiPath, '/openapi.yaml');
  assert.equal(parsedRegistration.metadata?.runtime?.repositoryId, 'example-app');
  assert.equal(parsedRegistration.metadata?.notes, 'Handles example workflows.');

  const legacyStylePayload = {
    slug: 'legacy-service',
    displayName: 'Legacy Service',
    kind: 'http',
    baseUrl: 'https://legacy.local',
    metadata: {
      repositoryId: 'legacy-app',
      baseUrl: 'https://legacy-runtime.local'
    }
  };

  const parsedLegacy = serviceRegistrationSchema.parse(legacyStylePayload);
  assert(parsedLegacy.metadata?.runtime, 'legacy runtime should be lifted into metadata.runtime');
  assert.equal(parsedLegacy.metadata?.runtime?.baseUrl, 'https://legacy-runtime.local');

  const existingMetadata = { manifest: { source: 'services/example.json' } } as JsonValue;
  const merged = mergeServiceMetadata(existingMetadata, parsedLegacy.metadata);
  const mergedCoerced = coerceServiceMetadata(merged);
  assert(mergedCoerced?.manifest, 'merged metadata should retain manifest block');
  assert.equal(mergedCoerced?.runtime?.repositoryId, 'legacy-app');
  assert.equal(mergedCoerced?.resourceType, 'service');

  const cleared = mergeServiceMetadata(merged, null);
  assert.equal(cleared, null, 'null metadata update should clear existing payload');

  const parsedPatch = servicePatchSchema.parse({ metadata: null });
  assert.equal(parsedPatch.metadata, null, 'patch schema should accept metadata: null');

  const invalid = serviceRegistrationSchema.safeParse({
    slug: 'invalid',
    displayName: 'Invalid Service',
    kind: 'http',
    baseUrl: 'https://invalid.local',
    metadata: { resourceType: 'app' }
  });
  assert(!invalid.success, 'invalid resourceType should be rejected');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
