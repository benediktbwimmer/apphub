import type { JsonValue } from '../db/types';
const BUNDLE_ENTRY_REGEX = /^bundle:([a-z0-9][a-z0-9._-]*)@([^#]+?)(?:#([a-zA-Z_$][\w$]*))?$/i;

type BundleBinding = {
  slug: string;
  version: string;
  exportName: string | null;
};

function parseBundleEntryPoint(entryPoint: string | null | undefined): BundleBinding | null {
  if (!entryPoint || typeof entryPoint !== 'string') {
    return null;
  }
  const trimmed = entryPoint.trim();
  const matches = BUNDLE_ENTRY_REGEX.exec(trimmed);
  if (!matches) {
    return null;
  }
  const [, rawSlug, rawVersion, rawExport] = matches;
  const slug = rawSlug.toLowerCase();
  const version = rawVersion.trim();
  if (!version) {
    return null;
  }
  return {
    slug,
    version,
    exportName: rawExport ?? null
  } satisfies BundleBinding;
}

export type SchemaPreview = {
  parametersSchema: JsonValue | null;
  outputSchema: JsonValue | null;
  parametersSource: string | null;
  outputSource: string | null;
};

function toJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

type ExtractionTarget = {
  parametersSchema: JsonValue | null;
  outputSchema: JsonValue | null;
  parametersSource: string | null;
  outputSource: string | null;
};

type SchemaCandidate = {
  value: JsonValue;
  source: string;
};

function pickSchema(
  record: Record<string, JsonValue>,
  keys: string[],
  prefix: string
): SchemaCandidate | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const candidate = record[key];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    return { value: candidate, source: `${prefix}.${key}` } satisfies SchemaCandidate;
  }
  return null;
}

function assignIfMissing(
  target: ExtractionTarget,
  kind: 'parametersSchema' | 'outputSchema',
  candidate: SchemaCandidate | null
): void {
  if (!candidate) {
    return;
  }
  if (kind === 'parametersSchema') {
    if (!target.parametersSchema) {
      target.parametersSchema = cloneJson(candidate.value);
      target.parametersSource = candidate.source;
    }
    return;
  }
  if (!target.outputSchema) {
    target.outputSchema = cloneJson(candidate.value);
    target.outputSource = candidate.source;
  }
}

function inspectRecord(record: Record<string, JsonValue>, prefix: string, target: ExtractionTarget): void {
  assignIfMissing(target, 'parametersSchema', pickSchema(record, ['parametersSchema', 'inputSchema', 'parameters', 'inputs'], prefix));
  assignIfMissing(target, 'outputSchema', pickSchema(record, ['outputSchema', 'resultSchema', 'output', 'outputs'], prefix));

  const schemas = toJsonObject(record.schemas);
  if (schemas) {
    inspectRecord(schemas, `${prefix}.schemas`, target);
  }

  const metadata = toJsonObject(record.metadata);
  if (metadata) {
    inspectRecord(metadata, `${prefix}.metadata`, target);
  }
}

type BundleSchemaSource = {
  metadata?: JsonValue | null;
  manifest?: JsonValue | null;
};

export function extractSchemasFromBundleVersion(source: BundleSchemaSource): SchemaPreview {
  const result: ExtractionTarget = {
    parametersSchema: null,
    outputSchema: null,
    parametersSource: null,
    outputSource: null
  } satisfies ExtractionTarget;

  const inspect = (value: JsonValue | null | undefined, origin: string) => {
    const record = toJsonObject(value);
    if (!record) {
      return;
    }
    inspectRecord(record, origin, result);
  };

  inspect(source.metadata ?? null, 'bundleVersion.metadata');
  inspect(source.manifest ?? null, 'bundleVersion.manifest');

  const manifestRecord = toJsonObject(source.manifest);
  if (manifestRecord?.metadata !== undefined) {
    inspect(manifestRecord.metadata ?? null, 'bundleVersion.manifest.metadata');
  }

  return {
    parametersSchema: result.parametersSchema,
    outputSchema: result.outputSchema,
    parametersSource: result.parametersSource,
    outputSource: result.outputSource
  } satisfies SchemaPreview;
}

export async function introspectEntryPointSchemas(entryPoint: string): Promise<SchemaPreview | null> {
  const binding = parseBundleEntryPoint(entryPoint);
  if (!binding) {
    return null;
  }
  const { getJobBundleVersion } = await import('../db/jobBundles');
  const version = await getJobBundleVersion(binding.slug, binding.version);
  if (!version) {
    return null;
  }

  return extractSchemasFromBundleVersion({
    metadata: version.metadata ?? null,
    manifest: version.manifest ?? null
  });
}
