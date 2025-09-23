import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  jobDefinitionCreateSchema,
  workflowDefinitionCreateSchema,
  aiJobWithBundleOutputSchema,
  aiWorkflowWithJobsOutputSchema
} from '../workflows/zodSchemas';
import type { CodexContextFile, CodexGenerationMode } from './codexRunner';
import type { AiBundleContext } from './bundleContext';

type JobSummary = {
  slug: string;
  name: string;
  type: string;
  version?: number | null;
  entryPoint: string;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  parametersSchema?: unknown;
  defaultParameters?: unknown;
  outputSchema?: unknown;
  metadata?: unknown;
  registryRef?: unknown;
};

type ServiceSummary = {
  slug: string;
  displayName: string;
  kind: string;
  baseUrl: string;
  status: string;
  statusMessage?: string | null;
  capabilities?: unknown;
  metadata?: unknown;
  openapi?: unknown;
};

type WorkflowSummary = {
  slug: string;
  name: string;
  version?: number | null;
  description?: string | null;
  steps?: unknown;
  triggers?: unknown;
  parametersSchema?: unknown;
  defaultParameters?: unknown;
  outputSchema?: unknown;
  metadata?: unknown;
};

export type BuildCodexContextOptions = {
  mode: CodexGenerationMode;
  jobs: ReadonlyArray<JobSummary>;
  services: ReadonlyArray<ServiceSummary>;
  workflows: ReadonlyArray<WorkflowSummary>;
  bundles?: ReadonlyArray<AiBundleContext>;
};

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sanitizeSegment(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  return normalized.length > 0 ? normalized : fallback;
}

function buildJsonSchemaFile(
  path: string,
  schemaName: string,
  schema: Parameters<typeof zodToJsonSchema>[0]
): CodexContextFile {
  const jsonSchema = zodToJsonSchema(schema, { name: schemaName, target: 'jsonSchema7' });
  return { path, contents: stringifyJson(jsonSchema) };
}

function jobDefinitionOverview(): string {
  return [
    '# Job Definition Reference',
    '',
    'Codex must output a single job definition object when operating in `job` mode.',
    '',
    'Required fields:',
    '- `slug` – string identifier (`[a-z0-9][a-z0-9-_]*`, max length 100).',
    '- `name` – human-readable title.',
    "- `type` – one of `'batch'`, `'service-triggered'`, `'manual'`.",
    '- `entryPoint` – handler identifier (e.g. `bundle:slug@version`).',
    '',
    'Optional fields:',
    '- `version` (integer ≥ 1).',
    '- `timeoutMs` (integer between 1,000 and 86,400,000).',
    '- `retryPolicy` with optional retry configuration.',
    '- `parametersSchema` / `defaultParameters` for runtime inputs.',
    '- `metadata` for arbitrary JSON metadata.',
    '',
    'Refer to `context/schemas/job-definition.json` for the full JSON Schema and `context/jobs/index.json` for the current catalog.'
  ].join('\n');
}

function workflowDefinitionOverview(): string {
  return [
    '# Workflow Definition Reference',
    '',
    'Workflow mode expects a single workflow definition object.',
    '',
    'Required fields:',
    '- `slug` – string identifier (`[a-z0-9][a-z0-9-_]*`, max length 100).',
    '- `name` – workflow title.',
    '- `steps` – array of at least one step. Each step must include an `id`, `name`, and type-specific properties.',
    '',
    'Optional fields include `version`, `description`, `triggers`, `parametersSchema`, `defaultParameters`, and `metadata`.',
    '',
    'Review `context/schemas/workflow-definition.json` and `context/workflows/index.json` for the live catalog.'
  ].join('\n');
}

function jobWithBundleOverview(): string {
  return [
    '# Job With Bundle Reference',
    '',
    'When operating in `job-with-bundle` mode, Codex must output an object with two top-level keys:',
    '',
    '```json',
    '{',
    '  "job": { /* job definition */ },',
    '  "bundle": { /* bundle specification */ }',
    '}',
    '```',
    '',
    '- `job` must satisfy the job definition schema described above.',
    '- `bundle` describes the Node.js bundle to publish and must include:',
    '  - `slug`, `version`, and `entryPoint`.',
    '  - `manifest` JSON (mirrors the bundle manifest file).',
    '  - `files`: array of objects with `path`, `contents`, optional `encoding` (`utf8` | `base64`), and optional `executable` flag.',
    '  - `capabilityFlags`: array of required capabilities; this should align with the `capabilities` listed in the manifest.',
    '',
    'Ensure the bundle contains a file matching the declared `entryPoint`. See `context/schemas/job-with-bundle.json`,',
    '`context/jobs/index.json`, and the service OpenAPI specs under `context/services/` for compatibility details.'
  ].join('\n');
}

function workflowWithJobsOverview(): string {
  return [
    '# Workflow With Jobs Plan Reference',
    '',
    'In `workflow-with-jobs` mode, Codex must deliver a workflow definition together with a dependency plan. The plan tells operators which jobs already exist, which new jobs they must generate, and where bundles are required.',
    '',
    'Output structure:',
    '```json',
    '{',
    '  "workflow": { /* workflow definition */ },',
    '  "dependencies": [',
    '    { "kind": "existing-job", "jobSlug": "existing-job", "description": "…", "rationale": "…" },',
    '    { "kind": "job", "jobSlug": "new-job", "name": "New job", "prompt": "Generation prompt", "summary": "…" },',
    '    {',
    '      "kind": "job-with-bundle",',
    '      "jobSlug": "new-job",',
    '      "name": "New orchestrator",',
    '      "prompt": "Generation prompt",',
    '      "bundleOutline": {',
    '        "entryPoint": "index.js",',
    '        "capabilities": ["fs"],',
    '        "files": [{ "path": "index.js", "description": "Main handler" }]',
    '      }',
    '    }',
    '  ],',
    '  "notes": "Optional operator guidance"',
    '}',
    '```',
    '',
    '- Include a dependency entry for every workflow job step. Use `existing-job` for catalog jobs that can be referenced immediately.',
    '- For new jobs, supply a concise `prompt` that operators can resend during the job-generation step. Capture any sequencing constraints under `dependsOn`.',
    '- `job-with-bundle` dependencies should outline the intended bundle entry point, required capabilities, and any critical files so operators understand the implementation scope.',
    '- Keep explanations short but actionable. Reserve broader follow-up guidance for the optional `notes` field (e.g. secrets to configure).'
  ].join('\n');
}

function serviceReferenceOverview(): string {
  return [
    '# Service Reference',
    '',
    'Service discovery data lives under `context/services/`. Each entry in `context/services/index.json` describes a service,',
    'and any available OpenAPI schema is written to `context/services/<slug>/openapi.json`.',
    '',
    'Codex can use these files to align workflow steps with the latest service endpoints and capabilities.'
  ].join('\n');
}

function splitOpenApi(openapi: unknown): { metadata: unknown; schema: unknown } {
  if (!openapi || typeof openapi !== 'object' || Array.isArray(openapi)) {
    return { metadata: openapi, schema: null };
  }
  const { schema, ...rest } = openapi as Record<string, unknown>;
  return { metadata: rest, schema: schema ?? null };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function buildJobCatalog(jobs: ReadonlyArray<JobSummary>) {
  return jobs.map((job) => ({
    slug: job.slug,
    name: job.name,
    type: job.type,
    version: job.version ?? null,
    entryPoint: job.entryPoint,
    timeoutMs: job.timeoutMs ?? null,
    retryPolicy: job.retryPolicy ?? null,
    parametersSchema: job.parametersSchema ?? {},
    defaultParameters: job.defaultParameters ?? {},
    outputSchema: job.outputSchema ?? {},
    metadata: job.metadata ?? null,
    registryRef: job.registryRef ?? null
  }));
}

function buildJobCatalogMarkdown(jobs: ReadonlyArray<JobSummary>): string {
  if (jobs.length === 0) {
    return [
      '# Job Catalog Overview',
      '',
      'No job definitions are registered in the catalog yet.'
    ].join('\n');
  }

  const lines: string[] = [
    '# Job Catalog Overview',
    '',
    'The JSON file at `context/jobs/index.json` provides machine-readable metadata for every job definition.',
    'Key details for the first few entries are summarized below.'
  ];

  const sampleLimit = 15;
  jobs.slice(0, sampleLimit).forEach((job) => {
    lines.push('', `## ${job.slug}`, '');
    lines.push(`- Name: ${job.name}`);
    lines.push(`- Type: ${job.type}`);
    lines.push(`- Entry point: \`${job.entryPoint}\``);
    if (typeof job.version === 'number') {
      lines.push(`- Version: ${job.version}`);
    }
    if (typeof job.timeoutMs === 'number') {
      lines.push(`- Timeout: ${job.timeoutMs} ms`);
    }
    if (job.registryRef && typeof job.registryRef === 'string' && job.registryRef.trim().length > 0) {
      lines.push(`- Registry reference: ${job.registryRef}`);
    }
    lines.push('- Parameters schema:', '```json', JSON.stringify(job.parametersSchema ?? {}, null, 2), '```');
    if (job.outputSchema && typeof job.outputSchema === 'object') {
      lines.push('- Output schema:', '```json', JSON.stringify(job.outputSchema ?? {}, null, 2), '```');
    }
    const defaultParams = job.defaultParameters && typeof job.defaultParameters === 'object'
      ? JSON.stringify(job.defaultParameters, null, 2)
      : null;
    if (defaultParams && defaultParams !== '{}') {
      lines.push('- Default parameters:', '```json', defaultParams, '```');
    }
  });

  if (jobs.length > sampleLimit) {
    lines.push('', `_… ${jobs.length - sampleLimit} additional jobs omitted. See the JSON catalog for the full list._`);
  }

  return lines.join('\n');
}

function buildServiceCatalog(services: ReadonlyArray<ServiceSummary>) {
  return services.map((service) => {
    const { metadata: openapiMeta } = splitOpenApi(service.openapi);
    return {
      slug: service.slug,
      displayName: service.displayName,
      kind: service.kind,
      baseUrl: service.baseUrl,
      status: service.status,
      statusMessage: service.statusMessage ?? null,
      capabilities: service.capabilities ?? null,
      metadata: service.metadata ?? null,
      openapi: openapiMeta ?? null
    };
  });
}

function buildServiceCatalogMarkdown(services: ReadonlyArray<ServiceSummary>): string {
  if (services.length === 0) {
    return [
      '# Service Catalog Overview',
      '',
      'No services are registered in the catalog yet.'
    ].join('\n');
  }

  const lines: string[] = [
    '# Service Catalog Overview',
    '',
    'Structured service metadata resides at `context/services/index.json`. Any OpenAPI schemas are stored under',
    '`context/services/<slug>/openapi.json`. The first few entries are highlighted below.'
  ];

  const sampleLimit = 12;
  services.slice(0, sampleLimit).forEach((service) => {
    lines.push('', `## ${service.slug}`, '');
    lines.push(`- Display name: ${service.displayName}`);
    lines.push(`- Kind: ${service.kind}`);
    lines.push(`- Base URL: ${service.baseUrl}`);
    lines.push(`- Status: ${service.status}${service.statusMessage ? ` (${service.statusMessage})` : ''}`);
    const { metadata: openapiMeta, schema } = splitOpenApi(service.openapi);
    if (schema) {
      const slug = sanitizeSegment(service.slug, 'service');
      lines.push(`- OpenAPI schema: \`context/services/${slug}/openapi.json\``);
    } else if (openapiMeta) {
      lines.push('- OpenAPI metadata available (no schema stored).');
    }
  });

  if (services.length > sampleLimit) {
    lines.push('', `_… ${services.length - sampleLimit} additional services omitted. Consult the JSON catalog for the remainder._`);
  }

  return lines.join('\n');
}

function buildWorkflowCatalog(workflows: ReadonlyArray<WorkflowSummary>) {
  return workflows.map((workflow) => ({
    slug: workflow.slug,
    name: workflow.name,
    version: workflow.version ?? null,
    description: workflow.description ?? null,
    steps: workflow.steps ?? [],
    triggers: workflow.triggers ?? [],
    parametersSchema: workflow.parametersSchema ?? {},
    defaultParameters: workflow.defaultParameters ?? null,
    outputSchema: workflow.outputSchema ?? {},
    metadata: workflow.metadata ?? null
  }));
}

function buildWorkflowCatalogMarkdown(workflows: ReadonlyArray<WorkflowSummary>): string {
  if (workflows.length === 0) {
    return [
      '# Workflow Catalog Overview',
      '',
      'No workflows are registered in the catalog yet.'
    ].join('\n');
  }

  const lines: string[] = [
    '# Workflow Catalog Overview',
    '',
    'The full workflow catalog is available at `context/workflows/index.json`. Selected entries are summarized below.'
  ];

  const sampleLimit = 10;
  workflows.slice(0, sampleLimit).forEach((workflow) => {
    lines.push('', `## ${workflow.slug}`, '');
    lines.push(`- Name: ${workflow.name}`);
    if (typeof workflow.version === 'number') {
      lines.push(`- Version: ${workflow.version}`);
    }
    if (workflow.description) {
      lines.push(`- Description: ${workflow.description}`);
    }
    const stepCount = Array.isArray(workflow.steps) ? workflow.steps.length : 0;
    lines.push(`- Step count: ${stepCount}`);
    if (workflow.outputSchema && typeof workflow.outputSchema === 'object') {
      lines.push('- Output schema:', '```json', JSON.stringify(workflow.outputSchema ?? {}, null, 2), '```');
    }
  });

  if (workflows.length > sampleLimit) {
    lines.push('', `_… ${workflows.length - sampleLimit} additional workflows omitted.`);
  }

  return lines.join('\n');
}

function buildServiceFiles(services: ReadonlyArray<ServiceSummary>): CodexContextFile[] {
  const files: CodexContextFile[] = [];
  const catalog = buildServiceCatalog(services);
  files.push({ path: 'context/services/index.json', contents: stringifyJson(catalog) });
  files.push({ path: 'context/services/README.md', contents: `${buildServiceCatalogMarkdown(services)}\n` });

  services.forEach((service, index) => {
    const { schema, metadata } = splitOpenApi(service.openapi);
    if (!schema) {
      return;
    }
    const safeSlug = sanitizeSegment(service.slug, `service-${index + 1}`);
    files.push({ path: `context/services/${safeSlug}/openapi.json`, contents: stringifyJson(schema) });
    files.push({
      path: `context/services/${safeSlug}/metadata.json`,
      contents: stringifyJson({ slug: service.slug, baseUrl: service.baseUrl, openapi: metadata ?? null })
    });
  });

  return files;
}

function sanitizeBundleFilePath(originalPath: string, fallback: string): string {
  const normalized = originalPath
    .replace(/\\+/g, '/')
    .replace(/^\.\/+/, '')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized
    .map((segment, index) => {
      const cleaned = segment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned.length > 0) {
        return cleaned;
      }
      return `${fallback}-${index + 1}`;
    })
    .join('/');
}

function buildBundleCatalog(bundles: ReadonlyArray<AiBundleContext>) {
  return bundles.map((bundle) => ({
    slug: bundle.slug,
    version: bundle.version,
    entryPoint: bundle.entryPoint,
    capabilityFlags: bundle.capabilityFlags,
    manifestPath: bundle.manifestPath ?? 'manifest.json',
    jobSlugs: bundle.jobSlugs,
    description: bundle.description ?? null,
    displayName: bundle.displayName ?? null
  }));
}

function buildBundleCatalogMarkdown(bundles: ReadonlyArray<AiBundleContext>): string {
  if (bundles.length === 0) {
    return [
      '# Bundle Catalog Overview',
      '',
      'No job bundles are in use by the catalog jobs.'
    ].join('\n');
  }

  const lines: string[] = [
    '# Bundle Catalog Overview',
    '',
    'Bundles described below are referenced by the current job catalog. Each directory under `context/bundles/` contains the manifest, metadata, and source files for the bundle.'
  ];

  bundles.forEach((bundle) => {
    lines.push('', `## ${bundle.slug}@${bundle.version}`, '');
    lines.push(`- Entry point: \`${bundle.entryPoint}\``);
    if (bundle.capabilityFlags.length > 0) {
      lines.push(`- Capabilities: ${bundle.capabilityFlags.join(', ')}`);
    } else {
      lines.push('- Capabilities: _none declared_');
    }
    if (bundle.jobSlugs.length > 0) {
      lines.push(`- Used by jobs: ${bundle.jobSlugs.join(', ')}`);
    }
    if (bundle.description) {
      lines.push(`- Description: ${bundle.description}`);
    }
  });

  return lines.join('\n');
}

type BundleFileIndexEntry = {
  path: string;
  encoding: 'utf8' | 'base64';
  executable: boolean;
  contextPath: string;
};

function buildBundleFiles(bundles: ReadonlyArray<AiBundleContext>): CodexContextFile[] {
  const files: CodexContextFile[] = [];
  const catalog = buildBundleCatalog(bundles);
  files.push({ path: 'context/bundles/index.json', contents: stringifyJson(catalog) });
  files.push({ path: 'context/bundles/README.md', contents: `${buildBundleCatalogMarkdown(bundles)}\n` });

  bundles.forEach((bundle, index) => {
    const slugSegment = sanitizeSegment(bundle.slug, `bundle-${index + 1}`);
    const versionSegment = sanitizeSegment(bundle.version, `v${index + 1}`);
    const bundleBasePath = `context/bundles/${slugSegment}/${versionSegment}`;
    files.push({ path: `${bundleBasePath}/manifest.json`, contents: stringifyJson(bundle.manifest) });
    files.push({
      path: `${bundleBasePath}/metadata.json`,
      contents: stringifyJson({
        slug: bundle.slug,
        version: bundle.version,
        entryPoint: bundle.entryPoint,
        capabilityFlags: bundle.capabilityFlags,
        manifestPath: bundle.manifestPath ?? 'manifest.json',
        jobSlugs: bundle.jobSlugs,
        description: bundle.description ?? null,
        displayName: bundle.displayName ?? null,
        metadata: bundle.metadata ?? null
      })
    });

    const fileIndex: BundleFileIndexEntry[] = [];
    bundle.files.forEach((file, fileIndexValue) => {
      const encoding = file.encoding === 'base64' ? 'base64' : 'utf8';
      const sanitized = sanitizeBundleFilePath(file.path, `file-${fileIndexValue + 1}`);
      const targetPathBase = `${bundleBasePath}/files/${sanitized}`;
      const contextPath = encoding === 'base64' ? `${targetPathBase}.base64` : targetPathBase;
      const contents = encoding === 'base64' ? ensureTrailingNewline(file.contents) : ensureTrailingNewline(file.contents);
      files.push({ path: contextPath, contents });
      fileIndex.push({
        path: file.path,
        encoding,
        executable: Boolean(file.executable),
        contextPath
      });
    });

    files.push({ path: `${bundleBasePath}/files/index.json`, contents: stringifyJson(fileIndex) });
  });

  return files;
}

export function buildCodexContextFiles(options: BuildCodexContextOptions): CodexContextFile[] {
  const { mode, jobs, services, workflows, bundles = [] } = options;
  const files: CodexContextFile[] = [
    buildJsonSchemaFile('context/schemas/job-definition.json', 'JobDefinition', jobDefinitionCreateSchema),
    { path: 'context/reference/job.md', contents: `${jobDefinitionOverview()}\n` },
    buildJsonSchemaFile('context/schemas/workflow-definition.json', 'WorkflowDefinition', workflowDefinitionCreateSchema),
    { path: 'context/reference/workflow.md', contents: `${workflowDefinitionOverview()}\n` },
    buildJsonSchemaFile('context/schemas/job-with-bundle.json', 'JobWithBundle', aiJobWithBundleOutputSchema),
    { path: 'context/reference/job-with-bundle.md', contents: `${jobWithBundleOverview()}\n` },
    buildJsonSchemaFile('context/schemas/workflow-with-jobs.json', 'WorkflowWithJobs', aiWorkflowWithJobsOutputSchema),
    { path: 'context/reference/workflow-with-jobs.md', contents: `${workflowWithJobsOverview()}\n` },
    { path: 'context/reference/services.md', contents: `${serviceReferenceOverview()}\n` },
    { path: 'context/jobs/index.json', contents: stringifyJson(buildJobCatalog(jobs)) },
    { path: 'context/jobs/README.md', contents: `${buildJobCatalogMarkdown(jobs)}\n` },
    { path: 'context/workflows/index.json', contents: stringifyJson(buildWorkflowCatalog(workflows)) },
    { path: 'context/workflows/README.md', contents: `${buildWorkflowCatalogMarkdown(workflows)}\n` }
  ];

  files.push(...buildServiceFiles(services));
  if (bundles.length > 0) {
    files.push(...buildBundleFiles(bundles));
  }

  // All schemas and catalogs are helpful regardless of mode today, but future modes could filter here.
  return files;
}
