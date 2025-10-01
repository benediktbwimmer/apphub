import { describe, expect, test, vi } from 'vitest';

process.env.APPHUB_EVENTS_MODE = process.env.APPHUB_EVENTS_MODE ?? 'inline';
process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

import { JobService, type JobServiceDependencies } from '../src/jobs/service';
import type { JobDefinitionRecord, JobRunRecord, JobBundleVersionRecord } from '../src/db/types';
import type { BundleEditorSnapshot } from '../src/jobs/bundleEditor';

function createLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  } as unknown as Parameters<JobService['runJob']>[2]['logger'];
}

function createJobDefinition(overrides: Partial<JobDefinitionRecord> = {}): JobDefinitionRecord {
  return {
    id: overrides.id ?? 'job-1',
    slug: overrides.slug ?? 'test-job',
    name: overrides.name ?? 'Test Job',
    version: overrides.version ?? 1,
    type: overrides.type ?? 'batch',
    runtime: overrides.runtime ?? 'node',
    entryPoint: overrides.entryPoint ?? 'bundle:test@1',
    parametersSchema: overrides.parametersSchema ?? {},
    defaultParameters: overrides.defaultParameters ?? {},
    outputSchema: overrides.outputSchema ?? {},
    timeoutMs: overrides.timeoutMs ?? null,
    retryPolicy: overrides.retryPolicy ?? null,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString()
  } satisfies JobDefinitionRecord;
}

function createJobRun(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: overrides.id ?? 'run-1',
    jobDefinitionId: overrides.jobDefinitionId ?? 'job-1',
    status: overrides.status ?? 'pending',
    parameters: overrides.parameters ?? {},
    result: overrides.result ?? null,
    errorMessage: overrides.errorMessage ?? null,
    logsUrl: overrides.logsUrl ?? null,
    metrics: overrides.metrics ?? null,
    context: overrides.context ?? null,
    timeoutMs: overrides.timeoutMs ?? null,
    attempt: overrides.attempt ?? 1,
    maxAttempts: overrides.maxAttempts ?? null,
    durationMs: overrides.durationMs ?? null,
    scheduledAt: overrides.scheduledAt ?? new Date().toISOString(),
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    lastHeartbeatAt: overrides.lastHeartbeatAt ?? null,
    retryCount: overrides.retryCount ?? 0,
    failureReason: overrides.failureReason ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString()
  } satisfies JobRunRecord;
}

function createBundleVersion(overrides: Partial<JobBundleVersionRecord> = {}): JobBundleVersionRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'bundle-version-1',
    bundleId: overrides.bundleId ?? 'bundle-1',
    slug: overrides.slug ?? 'example',
    version: overrides.version ?? '1.0.0',
    manifest: overrides.manifest ?? {},
    checksum: overrides.checksum ?? 'checksum',
    capabilityFlags: overrides.capabilityFlags ?? [],
    artifactStorage: overrides.artifactStorage ?? 'local',
    artifactPath: overrides.artifactPath ?? '/tmp/bundle.tgz',
    artifactContentType: overrides.artifactContentType ?? 'application/gzip',
    artifactSize: overrides.artifactSize ?? 128,
    immutable: overrides.immutable ?? false,
    status: overrides.status ?? 'published',
    publishedBy: overrides.publishedBy ?? null,
    publishedByKind: overrides.publishedByKind ?? null,
    publishedByTokenHash: overrides.publishedByTokenHash ?? null,
    publishedAt: overrides.publishedAt ?? now,
    deprecatedAt: overrides.deprecatedAt ?? null,
    replacedAt: overrides.replacedAt ?? null,
    replacedBy: overrides.replacedBy ?? null,
    metadata: overrides.metadata ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  } satisfies JobBundleVersionRecord;
}

function createSnapshot(overrides: Partial<BundleEditorSnapshot> = {}): BundleEditorSnapshot {
  const version = overrides.version ?? createBundleVersion();
  return {
    binding: overrides.binding ?? { slug: 'example', version: '1.0.0', exportName: null },
    version,
    suggestion:
      overrides.suggestion ?? {
        slug: 'example',
        version: '1.0.0',
        entryPoint: 'main.py',
        manifest: {},
        manifestPath: 'manifest.json',
        capabilityFlags: [],
        metadata: null,
        description: null,
        displayName: null,
        files: [
          {
            path: 'main.py',
            contents: "print('hello')",
            encoding: 'utf8'
          }
        ]
      },
    suggestionSource: overrides.suggestionSource ?? 'metadata',
    manifestPath: overrides.manifestPath ?? 'manifest.json',
    manifest: overrides.manifest ?? {},
    aiBuilderMetadata: overrides.aiBuilderMetadata ?? {},
    history: overrides.history ?? [],
    availableVersions: overrides.availableVersions ?? [version]
  } satisfies BundleEditorSnapshot;
}

function createDeps(overrides: Partial<JobServiceDependencies> = {}): JobServiceDependencies {
  const noop = vi.fn();
  return {
    listJobDefinitions: vi.fn().mockResolvedValue([]),
    getRuntimeReadiness: vi.fn().mockResolvedValue({}),
    listJobRuns: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    createJobDefinition: vi.fn(),
    upsertJobDefinition: vi.fn(),
    getJobDefinitionBySlug: vi.fn(),
    safeParseDockerJobMetadata: vi.fn().mockReturnValue({ success: true, data: {} }),
    isDockerRuntimeEnabled: vi.fn().mockReturnValue(true),
    introspectEntryPointSchemas: vi.fn(),
    previewPythonSnippet: vi.fn(),
    createPythonSnippetJob: vi.fn(),
    loadBundleEditorSnapshot: vi.fn(),
    findNextVersion: vi.fn().mockResolvedValue('1.0.1'),
    publishGeneratedBundle: vi.fn(),
    buildCodexContextFiles: vi.fn().mockReturnValue([]),
    runCodexGeneration: vi.fn(),
    runOpenAiGeneration: vi.fn(),
    runOpenRouterGeneration: vi.fn(),
    createJobRun: vi.fn(),
    executeJobRun: vi.fn(),
    completeJobRun: vi.fn(),
    getJobRunById: vi.fn(),
    listJobRunsForDefinition: vi.fn().mockResolvedValue([]),
    enqueueRepositoryIngestion: vi.fn(),
    enqueueBuildJob: vi.fn(),
    getBuildById: vi.fn(),
    ...overrides
  } satisfies JobServiceDependencies;
}

describe('JobService runJob', () => {
  test('fails when repository-ingest run is missing repositoryId', async () => {
    const job = createJobDefinition({ slug: 'repository-ingest' });
    const run = createJobRun({ jobDefinitionId: job.id, parameters: {} });
    const deps = createDeps({
      getJobDefinitionBySlug: vi.fn().mockResolvedValue(job),
      createJobRun: vi.fn().mockResolvedValue(run),
      completeJobRun: vi.fn().mockResolvedValue(undefined)
    });
    const service = new JobService(deps);

    await expect(() => service.runJob(job.slug, {}, { logger: createLogger() }))
      .rejects.toMatchObject({ code: 'missing_parameter', statusCode: 400 });

    expect(deps.completeJobRun).toHaveBeenCalledWith(run.id, 'failed', {
      errorMessage: 'repositoryId parameter is required'
    });
    expect(deps.enqueueRepositoryIngestion).not.toHaveBeenCalled();
  });

  test('marks failures when execution throws for general jobs', async () => {
    const job = createJobDefinition({ slug: 'custom-job' });
    const run = createJobRun({ jobDefinitionId: job.id });
    const deps = createDeps({
      getJobDefinitionBySlug: vi.fn().mockResolvedValue(job),
      createJobRun: vi.fn().mockResolvedValue(run),
      executeJobRun: vi.fn().mockRejectedValue(new Error('boom')),
      completeJobRun: vi.fn().mockResolvedValue(undefined),
      getJobRunById: vi.fn().mockResolvedValue(run)
    });
    const service = new JobService(deps);

    await expect(() => service.runJob(job.slug, {}, { logger: createLogger() }))
      .rejects.toMatchObject({ code: 'execution_error', statusCode: 502 });

    expect(deps.completeJobRun).toHaveBeenCalledTimes(1);
    expect(deps.completeJobRun).toHaveBeenCalledWith(run.id, 'failed', {
      errorMessage: 'boom'
    });
  });
});

describe('JobService aiEditBundle', () => {
  test('propagates validation failures when AI output is invalid', async () => {
    const job = createJobDefinition({ slug: 'analytics', entryPoint: 'bundle:example@1' });
    const snapshot = createSnapshot();
    const deps = createDeps({
      getJobDefinitionBySlug: vi.fn().mockResolvedValue(job),
      loadBundleEditorSnapshot: vi.fn().mockResolvedValue(snapshot),
      runCodexGeneration: vi.fn().mockResolvedValue({ output: 'not-json', summary: null })
    });
    const service = new JobService(deps);

    await expect(() =>
      service.aiEditBundle(
        { slug: job.slug, prompt: 'update bundle', provider: 'codex' },
        { subject: 'tester', kind: 'user', tokenHash: 'hash' },
        { logger: createLogger() }
      )
    ).rejects.toMatchObject({ code: 'ai_bundle_validation_failed', statusCode: 422 });

    expect(deps.publishGeneratedBundle).not.toHaveBeenCalled();
  });

  test('publishes regenerated bundle when AI output is valid', async () => {
    const job = createJobDefinition({ slug: 'analytics', entryPoint: 'bundle:example@1', metadata: {} });
    const initialSnapshot = createSnapshot({
      suggestion: {
        slug: 'example',
        version: '1.0.0',
        entryPoint: 'main.py',
        manifest: { capabilities: ['net'] },
        manifestPath: 'manifest.json',
        capabilityFlags: ['net'],
        metadata: null,
        description: null,
        displayName: null,
        files: [
          {
            path: 'main.py',
            contents: "print('hello')",
            encoding: 'utf8'
          }
        ]
      }
    });
    const refreshedSnapshot = createSnapshot({
      binding: { slug: 'example', version: '1.1.0', exportName: null }
    });
    const updatedJob = createJobDefinition({
      slug: job.slug,
      entryPoint: 'bundle:example@1.1.0',
      version: job.version,
      metadata: {}
    });

    const deps = createDeps({
      getJobDefinitionBySlug: vi.fn().mockResolvedValue(job),
      loadBundleEditorSnapshot: vi
        .fn()
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(refreshedSnapshot),
      runCodexGeneration: vi.fn().mockResolvedValue({
        output: JSON.stringify({
          job: {
            slug: job.slug,
            name: job.name,
            type: job.type,
            runtime: job.runtime,
            entryPoint: 'bundle:example@1'
          },
          bundle: {
            slug: 'example',
            version: 'draft-1',
            entryPoint: 'main.py',
            manifestPath: 'manifest.json',
            manifest: { capabilities: ['net'] },
            capabilityFlags: ['net'],
            metadata: null,
            description: null,
            displayName: null,
            files: [
              {
                path: 'main.py',
                contents: "print('hello')",
                encoding: 'utf8'
              }
            ]
          }
        }),
        summary: 'updated'
      }),
      findNextVersion: vi.fn().mockResolvedValue('1.1.0'),
      publishGeneratedBundle: vi.fn().mockResolvedValue({
        bundle: {
          id: 'bundle-1',
          slug: 'example',
          displayName: 'Example',
          description: null,
          latestVersion: '1.1.0',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        version: createBundleVersion({ version: '1.1.0' }),
        download: { url: 'https://example.com', expiresAt: new Date().toISOString() }
      }),
      upsertJobDefinition: vi.fn().mockResolvedValue(updatedJob)
    });
    const service = new JobService(deps);

    const result = await service.aiEditBundle(
      { slug: job.slug, prompt: 'update bundle', provider: 'codex' },
      { subject: 'tester', kind: 'user', tokenHash: 'hash' },
      { logger: createLogger() }
    );

    expect(deps.publishGeneratedBundle).toHaveBeenCalled();
    expect(deps.upsertJobDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ entryPoint: 'bundle:example@1.1.0' })
    );
    expect(result.job.entryPoint).toBe('bundle:example@1.1.0');
    expect(result.snapshot.binding.version).toBe('1.1.0');
  });
});
