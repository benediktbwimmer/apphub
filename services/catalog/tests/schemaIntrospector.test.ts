process.env.APPHUB_EVENTS_MODE = process.env.APPHUB_EVENTS_MODE ?? 'redis';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
process.env.APPHUB_ANALYTICS_INTERVAL_MS = '0';

import assert from 'node:assert/strict';
import type { JsonValue } from '../src/db/types';

const { extractSchemasFromBundleVersion } = require('../src/jobs/schemaIntrospector') as typeof import('../src/jobs/schemaIntrospector');

type SchemaPreview = ReturnType<typeof extractSchemasFromBundleVersion>;

function extract(metadata: JsonValue | null, manifest: JsonValue | null): SchemaPreview {
  return extractSchemasFromBundleVersion({ metadata, manifest });
}

const basicMetadata = {
  parametersSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' }
    },
    required: ['path']
  },
  outputSchema: {
    type: 'object',
    properties: {
      contents: { type: 'string' }
    }
  }
} satisfies JsonValue;

(() => {
  const preview = extract(basicMetadata, null);
  assert.deepEqual(preview.parametersSchema, basicMetadata.parametersSchema);
  assert.equal(preview.parametersSource, 'bundleVersion.metadata.parametersSchema');
  assert.deepEqual(preview.outputSchema, basicMetadata.outputSchema);
  assert.equal(preview.outputSource, 'bundleVersion.metadata.outputSchema');
})();

(() => {
  const metadata = {
    schemas: {
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' }
        }
      }
    }
  } satisfies JsonValue;
  const manifest = {
    metadata: {
      output: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  } satisfies JsonValue;

  const preview = extract(metadata, manifest);
  assert.deepEqual(preview.parametersSchema, metadata.schemas.parameters);
  assert.equal(preview.parametersSource, 'bundleVersion.metadata.schemas.parameters');
  assert.deepEqual(preview.outputSchema, manifest.metadata.output);
  assert.equal(preview.outputSource, 'bundleVersion.manifest.metadata.output');
})();

(() => {
  const manifest = {
    schemas: {
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        }
      },
      resultSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] }
        }
      }
    }
  } satisfies JsonValue;

  const preview = extract(null, manifest);
  assert.deepEqual(preview.parametersSchema, manifest.schemas.inputSchema);
  assert.equal(preview.parametersSource, 'bundleVersion.manifest.schemas.inputSchema');
  assert.deepEqual(preview.outputSchema, manifest.schemas.resultSchema);
  assert.equal(preview.outputSource, 'bundleVersion.manifest.schemas.resultSchema');
})();

(() => {
  const preview = extract('not-json-object' as JsonValue, 123 as JsonValue);
  assert.equal(preview.parametersSchema, null);
  assert.equal(preview.parametersSource, null);
  assert.equal(preview.outputSchema, null);
  assert.equal(preview.outputSource, null);
})();
