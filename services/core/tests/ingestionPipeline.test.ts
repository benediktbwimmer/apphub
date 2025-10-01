import './setupTestEnv';
import assert from 'node:assert/strict';
import { processRepository } from '../src/ingestion';
import { createCloneRepositoryStage } from '../src/ingestion/stages/cloneRepository';
import { metadataStage } from '../src/ingestion/stages/metadata';
import { createTagAggregationStage } from '../src/ingestion/stages/tags';
import { createPersistenceStage } from '../src/ingestion/stages/persistence';
import { createBuildStage } from '../src/ingestion/stages/build';
import { buildRepositoryRecord, createSampleRepository } from './helpers/ingestionTestUtils';

async function run() {
  const sample = await createSampleRepository();
  try {
    const repository = buildRepositoryRecord(sample.repoPath, {
      repoUrl: sample.repoPath,
      name: 'Legacy Name',
      description: 'Legacy description'
    });

    const calls: Record<string, unknown> = {};

    const stages = [
      createCloneRepositoryStage(),
      metadataStage,
      createTagAggregationStage({ listNetworksForMemberRepository: async () => ['network-x'] }),
      createPersistenceStage({
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
          calls.persistenceStatus = { repositoryId, status, update };
        }
      }),
      createBuildStage({
        createBuild: async (repositoryId, input) => {
          calls.createBuild = { repositoryId, input };
          return { id: 'build-789' } as { id: string };
        },
        enqueueBuildJob: async (buildId, repositoryId) => {
          calls.enqueueBuild = { buildId, repositoryId };
          return { id: 'job-1011' } as { id: string };
        }
      })
    ];

    const failureStatusCalls: Array<{ repositoryId: string; status: string }> = [];

    const result = await processRepository(repository, {
      inlineQueueMode: false,
      stages,
      setRepositoryStatus: async (repositoryId, status, update) => {
        failureStatusCalls.push({ repositoryId, status });
        calls.failureStatus = { repositoryId, status, update };
      }
    });

    assert.equal(result.commitSha, sample.commitSha);
    assert.equal(result.metrics.length, stages.length);

    const upsert = calls.upsert as { name: string; description: string };
    assert.equal(upsert.name, 'demo-app');
    assert.equal(upsert.description, 'A concise summary.');

    const persistenceStatus = calls.persistenceStatus as {
      status: string;
      update: { commitSha: string | null };
    };
    assert.equal(persistenceStatus.status, 'ready');
    assert.equal(persistenceStatus.update.commitSha, sample.commitSha);

    assert.deepEqual(calls.createBuild, {
      repositoryId: repository.id,
      input: { commitSha: sample.commitSha }
    });
    assert.deepEqual(calls.enqueueBuild, {
      buildId: 'build-789',
      repositoryId: repository.id
    });

    assert.equal(failureStatusCalls.length, 0, 'failure handler should not run on success');
  } finally {
    await sample.cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
