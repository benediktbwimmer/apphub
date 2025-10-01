import type { JsonValue, JobDefinitionRecord } from '../db/types';
import { getJobDefinitionBySlug, upsertJobDefinition } from '../db/jobs';
import { getJobBundleVersion, listJobBundleVersions } from '../db/jobBundles';
import {
  publishGeneratedBundle,
  type AiGeneratedBundleSuggestion,
  type PublishActor
} from '../ai/bundlePublisher';
import type { JobDefinitionCreateInput } from '../db';
import { analyzePythonSnippet, type PythonSnippetAnalysis } from './pythonSnippetAnalyzer';
import type { PublishActorContext } from './registryService';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export type PythonSnippetPreview = PythonSnippetAnalysis;

export type PythonSnippetJobInput = {
  slug: string;
  name: string;
  type: 'batch' | 'service-triggered' | 'manual';
  snippet: string;
  dependencies?: string[];
  timeoutMs?: number | null;
  versionStrategy: 'auto' | 'manual';
  bundleSlug?: string | null;
  bundleVersion?: string | null;
  jobVersion?: number | null;
};

export type PythonSnippetJobResult = {
  job: JobDefinitionRecord;
  bundle: {
    slug: string;
    version: string;
  };
  analysis: PythonSnippetAnalysis;
};

export class PythonSnippetBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonSnippetBuilderError';
  }
}

export async function previewPythonSnippet(snippet: string): Promise<PythonSnippetPreview> {
  return analyzePythonSnippet(snippet);
}

export async function createPythonSnippetJob(
  input: PythonSnippetJobInput,
  actor: PublishActorContext
): Promise<PythonSnippetJobResult> {
  const analysis = await analyzePythonSnippet(input.snippet);
  const dependencies = normalizeDependencies(input.dependencies ?? []);
  const bundleSlug = normalizeSlug(input.bundleSlug ?? input.slug);
  if (!bundleSlug) {
    throw new PythonSnippetBuilderError('Bundle slug is required');
  }

  const bundleVersion = await resolveBundleVersion(bundleSlug, input.versionStrategy, input.bundleVersion);
  const jobDefinition = await getJobDefinitionBySlug(input.slug);
  const jobVersion = resolveJobVersion(jobDefinition, input.jobVersion);

  const bundleSuggestion = buildBundleSuggestion({
    bundleSlug,
    bundleVersion,
    jobName: input.name,
    snippet: input.snippet,
    analysis,
    dependencies
  });

  const publishActor: PublishActor = {
    subject: actor.subject ?? null,
    kind: actor.kind ?? null,
    tokenHash: actor.tokenHash ?? null
  };

  const bundleResult = await publishGeneratedBundle(bundleSuggestion, publishActor);

  const jobInput: JobDefinitionCreateInput = {
    slug: input.slug,
    name: input.name,
    type: input.type,
    runtime: 'python',
    entryPoint: `bundle:${bundleSlug}@${bundleVersion}#handler`,
    version: jobVersion,
    timeoutMs: input.timeoutMs ?? jobDefinition?.timeoutMs ?? null,
    retryPolicy: jobDefinition?.retryPolicy ?? null,
    parametersSchema: analysis.inputModel.schema as JsonValue,
    defaultParameters: jobDefinition?.defaultParameters ?? {},
    outputSchema: analysis.outputModel.schema as JsonValue,
    metadata: buildJobMetadata(jobDefinition?.metadata ?? null, {
      dependencies,
      analysis,
      bundle: {
        slug: bundleSlug,
        version: bundleVersion
      }
    })
  };

  const job = await upsertJobDefinition(jobInput);

  return {
    job,
    bundle: { slug: bundleResult.bundle.slug, version: bundleResult.version.version },
    analysis
  } satisfies PythonSnippetJobResult;
}

function normalizeSlug(slug: string | null | undefined): string {
  return slug ? slug.trim().toLowerCase() : '';
}

function normalizeDependencies(raw: string[]): string[] {
  const sanitized = raw
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      if (entry.length > 120) {
        throw new PythonSnippetBuilderError(`Dependency '${entry.slice(0, 40)}…' is too long`);
      }
      if (/[,;&|]/.test(entry)) {
        throw new PythonSnippetBuilderError(`Dependency '${entry}' contains unsupported characters`);
      }
      if (!/^[A-Za-z0-9._\-\[\]\(\)<>!=~\*\+ ]+$/.test(entry)) {
        throw new PythonSnippetBuilderError(`Dependency '${entry}' contains unsupported characters`);
      }
      return true;
    });

  const unique = new Map<string, string>();
  for (const entry of sanitized) {
    const key = entry.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, entry);
    }
  }
  if (!unique.has('pydantic')) {
    unique.set('pydantic', 'pydantic');
  }
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
}

async function resolveBundleVersion(
  bundleSlug: string,
  strategy: 'auto' | 'manual',
  requestedVersion?: string | null
): Promise<string> {
  if (strategy === 'manual') {
    const version = (requestedVersion ?? '').trim();
    if (!version) {
      throw new PythonSnippetBuilderError('Manual bundle version required');
    }
    const existing = await getJobBundleVersion(bundleSlug, version);
    if (existing) {
      throw new PythonSnippetBuilderError(
        `Bundle version ${bundleSlug}@${version} already exists`
      );
    }
    return version;
  }

  const versions = await listJobBundleVersions(bundleSlug);
  if (!versions.length) {
    return '1.0.0';
  }
  const latest = versions
    .map((record) => record.version)
    .filter((version): version is string => typeof version === 'string' && version.trim().length > 0)
    .reduce<string | null>((current, candidate) => {
      if (!current) {
        return candidate;
      }
      return compareVersions(candidate, current) > 0 ? candidate : current;
    }, null);
  if (!latest) {
    return '1.0.0';
  }
  return bumpVersion(latest);
}

function bumpVersion(current: string): string {
  const match = SEMVER_PATTERN.exec(current.trim());
  if (match) {
    const major = Number.parseInt(match[1], 10);
    const minor = Number.parseInt(match[2], 10);
    const patch = Number.parseInt(match[3], 10);
    return `${major}.${minor}.${patch + 1}`;
  }
  const numeric = Number.parseInt(current, 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(numeric + 1);
  }
  return '1.0.0';
}

function compareVersions(a: string, b: string): number {
  const as = a.trim();
  const bs = b.trim();
  const aMatch = SEMVER_PATTERN.exec(as);
  const bMatch = SEMVER_PATTERN.exec(bs);
  if (aMatch && bMatch) {
    for (let index = 1; index <= 3; index += 1) {
      const diff = Number.parseInt(aMatch[index], 10) - Number.parseInt(bMatch[index], 10);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  }
  if (aMatch) {
    return 1;
  }
  if (bMatch) {
    return -1;
  }
  return as.localeCompare(bs);
}

function resolveJobVersion(existing: JobDefinitionRecord | null, requested?: number | null): number {
  if (requested && requested >= 1) {
    return Math.floor(requested);
  }
  if (!existing) {
    return 1;
  }
  const next = (existing.version ?? 0) + 1;
  return next < 1 ? 1 : next;
}

function buildBundleSuggestion(options: {
  bundleSlug: string;
  bundleVersion: string;
  jobName: string;
  snippet: string;
  analysis: PythonSnippetAnalysis;
  dependencies: string[];
}): AiGeneratedBundleSuggestion {
  const handlerSource = buildHandlerSource(options.snippet, options.analysis);
  const requirements = options.dependencies.join('\n') + '\n';
  return {
    slug: options.bundleSlug,
    version: options.bundleVersion,
    entryPoint: 'handler.py',
    manifestPath: 'manifest.json',
    manifest: {
      name: options.jobName,
      version: options.bundleVersion,
      entry: 'handler.py',
      runtime: 'python',
      metadata: {
        apphub: {
          generator: 'python-snippet',
          generatedAt: new Date().toISOString(),
          handler: options.analysis.handlerName,
          inputModel: options.analysis.inputModel.name,
          outputModel: options.analysis.outputModel.name,
          dependencies: options.dependencies
        }
      }
    },
    capabilityFlags: ['python'],
    files: [
      {
        path: 'handler.py',
        contents: handlerSource,
        encoding: 'utf8'
      },
      {
        path: 'requirements.txt',
        contents: requirements,
        encoding: 'utf8'
      }
    ]
  } satisfies AiGeneratedBundleSuggestion;
}

function buildHandlerSource(snippet: string, analysis: PythonSnippetAnalysis): string {
  const normalizedSnippet = ensureTrailingNewline(snippet);
  const wrapper = `\n\nimport inspect\nfrom pydantic import ValidationError\n\n_INPUT_MODEL = ${analysis.inputModel.name}\n_OUTPUT_MODEL = ${analysis.outputModel.name}\n_SNIPPET_HANDLER = ${analysis.handlerName}\n\nasync def handler(context):\n    raw_parameters = getattr(context, 'parameters', None) or {}\n    try:\n        payload = _INPUT_MODEL.model_validate(raw_parameters)\n    except ValidationError as exc:\n        context.logger('Invalid parameters', {'errors': exc.errors()})\n        return {\n            'status': 'failed',\n            'errorMessage': 'Invalid input parameters',\n            'result': {'errors': exc.errors()}\n        }\n\n    result = _SNIPPET_HANDLER(payload)\n    if inspect.isawaitable(result):\n        result = await result\n\n    if isinstance(result, _OUTPUT_MODEL):\n        normalized = result\n    else:\n        try:\n            normalized = _OUTPUT_MODEL.model_validate(result)\n        except ValidationError as exc:\n            context.logger('Invalid output from snippet', {'errors': exc.errors()})\n            return {\n                'status': 'failed',\n                'errorMessage': 'Snippet returned invalid output',\n                'result': {'errors': exc.errors()}\n            }\n\n    return {\n        'status': 'succeeded',\n        'result': normalized.model_dump()\n    }\n`;
  return `# Generated by AppHub Python snippet builder\n${normalizedSnippet}${wrapper}`;
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function buildJobMetadata(
  existing: JsonValue | null,
  details: {
    dependencies: string[];
    analysis: PythonSnippetAnalysis;
    bundle: { slug: string; version: string };
  }
): JsonValue {
  const baseMetadata: Record<string, JsonValue> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, JsonValue>) }
      : {};
  const snippetMetadata = {
    updatedAt: new Date().toISOString(),
    handler: details.analysis.handlerName,
    inputModel: details.analysis.inputModel.name,
    outputModel: details.analysis.outputModel.name,
    dependencies: details.dependencies,
    bundle: details.bundle
  } satisfies Record<string, JsonValue>;
  baseMetadata.pythonSnippet = snippetMetadata as JsonValue;
  return baseMetadata as JsonValue;
}
