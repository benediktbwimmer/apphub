import './setupTestEnv';
import assert from 'node:assert/strict';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createCloneRepositoryStage } from '../src/ingestion/stages/cloneRepository';
import { metadataStage } from '../src/ingestion/stages/metadata';
import { createTagAggregationStage } from '../src/ingestion/stages/tags';
import { createPersistenceStage } from '../src/ingestion/stages/persistence';
import { createBuildStage } from '../src/ingestion/stages/build';
import {
  buildPipelineContext,
  buildRepositoryRecord,
  createSampleRepository
} from './helpers/ingestionTestUtils';
import type { IngestionPipelineContext } from '../src/ingestion/types';

async function withContext(
  repoPath: string,
  commitSha: string,
  overrides: Partial<IngestionPipelineContext> = {}
) {
  const repository = buildRepositoryRecord(repoPath, { repoUrl: repoPath });
  return buildPipelineContext(repository, {
    workingDir: repoPath,
    commitSha,
    ...overrides
  });
}

async function testCloneStage() {
  const sample = await createSampleRepository();
  try {
    const repository = buildRepositoryRecord(sample.repoPath, { repoUrl: sample.repoPath });
    const context = buildPipelineContext(repository);
    const cloneStage = createCloneRepositoryStage();
    await cloneStage.run(context);

    assert(context.workingDir, 'working directory should be set');
    assert.equal(context.commitSha, sample.commitSha);
    const gitDir = path.join(context.workingDir as string, '.git');
    const stats = await stat(gitDir);
    assert(stats.isDirectory(), 'expected cloned repository to have .git directory');

    // Cleanup should remove the working directory
    await Promise.all(context.cleanupTasks.map((fn) => fn()));
    await assert.rejects(access(gitDir), /ENOENT/, 'cleanup should remove cloned directory');
  } finally {
    await sample.cleanup();
  }
}

async function testMetadataStage() {
  const sample = await createSampleRepository();
  try {
    const context = await withContext(sample.repoPath, sample.commitSha);
    await metadataStage.run(context);

    assert.equal(context.dockerfilePath, 'Dockerfile');
    assert(context.packageMetadata, 'package metadata should be discovered');
    assert(
      context.packageMetadata?.tags.some((tag) => tag.key === 'library' && tag.value === 'react'),
      'expected react dependency tag'
    );
    assert(
      context.declaredTags.some((tag) => tag.key === 'category' && tag.value === 'demo'),
      'expected tag file entry'
    );
    assert.equal(context.previewTiles.length, 3, 'expected preview tiles from manifest and README');
    assert.equal(context.readmeMetadata?.summary, 'A concise summary.');
  } finally {
    await sample.cleanup();
  }
}

async function testTagAggregationStage() {
  const sample = await createSampleRepository();
  try {
    const repository = buildRepositoryRecord(sample.repoPath, {
      repoUrl: sample.repoPath,
      tags: [{ key: 'source', value: 'author', source: 'author' }]
    });
    const context = buildPipelineContext(repository, {
      workingDir: sample.repoPath,
      commitSha: sample.commitSha
    });
    await metadataStage.run(context);
    const tagStage = createTagAggregationStage({
      listNetworksForMemberRepository: async () => ['network-a', 'network-b']
    });
    await tagStage.run(context);

    const tags = Array.from(context.tagMap.values());
    const assertTag = (key: string, value: string) =>
      assert(
        tags.some((tag) => tag.key === key && tag.value === value),
        `expected tag ${key}:${value}`
      );

    assertTag('source', 'author');
    assertTag('category', 'demo');
    assertTag('library', 'react');
    assertTag('service-network', 'network-a');
    assert(
      tags.some((tag) => tag.key === 'runtime' && tag.value.startsWith('node')),
      'expected runtime tag from Dockerfile'
    );
  } finally {
    await sample.cleanup();
  }
}

async function testPersistenceStage() {
  const sample = await createSampleRepository();
  try {
    const repository = buildRepositoryRecord(sample.repoPath, {
      repoUrl: sample.repoPath,
      name: 'Original Name',
      description: 'Original description'
    });
    const context = buildPipelineContext(repository, {
      workingDir: sample.repoPath,
      commitSha: sample.commitSha,
      processingStartedAt: Date.now() - 25
    });
    await metadataStage.run(context);
    const tagStage = createTagAggregationStage({ listNetworksForMemberRepository: async () => [] });
    await tagStage.run(context);

    const calls: {
      upsert?: unknown;
      replacePreviews?: unknown;
      replaceTags?: unknown;
      setStatus?: unknown;
    } = {};

    const persistence = createPersistenceStage({
      upsertRepository: async (input) => {
        calls.upsert = input;
      },
      replaceRepositoryPreviews: async (repositoryId, previews) => {
        calls.replacePreviews = { repositoryId, previews };
      },
      replaceRepositoryTags: async (repositoryId, tags, options) => {
        calls.replaceTags = { repositoryId, tags, options };
      },
      setRepositoryStatus: async (repositoryId, status, update) => {
        calls.setStatus = { repositoryId, status, update };
      }
    });

    await persistence.run(context);

    assert.equal(
      (calls.upsert as { name: string }).name,
      'demo-app',
      'expected repository name to adopt package name'
    );
    assert.equal(
      (calls.upsert as { description: string }).description,
      'A concise summary.',
      'expected repository description from README summary'
    );
    const replacePreviews = calls.replacePreviews as { previews: unknown[] };
    assert.equal(replacePreviews.previews.length, context.previewTiles.length);
    const replaceTags = calls.replaceTags as { tags: unknown[]; options: { clearExisting: boolean } };
    assert.equal(replaceTags.tags.length, context.tagMap.size);
    assert.equal(replaceTags.options.clearExisting, true);

    const statusCall = calls.setStatus as {
      status: string;
      update: { durationMs: number };
    };
    assert.equal(statusCall.status, 'ready');
    assert(statusCall.update.durationMs >= 0);
    assert.equal(context.repositoryName, 'demo-app');
    assert.equal(context.repositoryDescription, 'A concise summary.');
  } finally {
    await sample.cleanup();
  }
}

async function testBuildStage() {
  const repository = buildRepositoryRecord('file:///tmp/repo', { repoUrl: 'file:///tmp/repo' });
  const context = buildPipelineContext(repository, {
    commitSha: 'abc123',
    inlineQueueMode: true
  });

  const calls: {
    create?: unknown;
    enqueue?: unknown;
  } = {};

  const buildStage = createBuildStage({
    createBuild: async (repositoryId, input) => {
      calls.create = { repositoryId, input };
      return { id: 'build-123' } as { id: string };
    },
    enqueueBuildJob: async (buildId, repositoryId) => {
      calls.enqueue = { buildId, repositoryId };
      return { id: 'job-456' } as { id: string };
    }
  });

  await buildStage.run(context);
  assert.equal(context.buildId, 'build-123');
  assert.deepEqual(calls.create, {
    repositoryId: repository.id,
    input: { commitSha: 'abc123' }
  });
  assert.deepEqual(calls.enqueue, {
    buildId: 'build-123',
    repositoryId: repository.id
  });
}

async function run() {
  await testCloneStage();
  await testMetadataStage();
  await testTagAggregationStage();
  await testPersistenceStage();
  await testBuildStage();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
