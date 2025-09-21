import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../schemas/job-bundle-manifest.schema.json';
import type { JobBundleManifest } from '../types';

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false
});
addFormats(ajv);

const validate = ajv.compile<JobBundleManifest>(schema as unknown as object);

export function validateManifest(manifest: unknown): JobBundleManifest {
  if (validate(manifest)) {
    return manifest;
  }
  const errors = validate.errors ?? [];
  const details = errors
    .map((error) => {
      const dataPath = error.instancePath || error.schemaPath;
      return `${dataPath}: ${error.message ?? 'invalid value'}`;
    })
    .join('\n');
  const error = new Error(`Manifest validation failed${details ? `\n${details}` : ''}`);
  error.name = 'ManifestValidationError';
  throw error;
}
