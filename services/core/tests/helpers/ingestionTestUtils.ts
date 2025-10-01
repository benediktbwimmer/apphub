import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import type { RepositoryRecord } from '../../src/db/index';
import type { IngestionPipelineContext } from '../../src/ingestion/types';

export async function createSampleRepository() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ingestion-stage-src-'));
  const git = simpleGit(repoRoot);
  await git.init();

  await writeFile(
    path.join(repoRoot, 'Dockerfile'),
    ['FROM node:18-bullseye', 'RUN npm install', 'CMD ["npm", "start"]'].join('\n'),
    'utf8'
  );

  const packageJson = {
    name: 'demo-app',
    description: 'Demo application',
    version: '0.0.1',
    dependencies: {
      react: '^18.2.0'
    },
    devDependencies: {
      typescript: '^5.0.0'
    }
  };
  await writeFile(path.join(repoRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  await mkdir(path.join(repoRoot, '.apphub'), { recursive: true });
  await writeFile(
    path.join(repoRoot, '.apphub', 'tags.json'),
    `${JSON.stringify(
      {
        category: 'demo',
        nested: {
          level: 'one'
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  await writeFile(
    path.join(repoRoot, '.apphub', 'previews.json'),
    `${JSON.stringify(
      [
        {
          type: 'image',
          title: 'Manifest Preview',
          src: 'https://example.com/manifest.png'
        },
        {
          kind: 'storybook',
          storybookUrl: 'https://storybook.example.com',
          storyId: 'components-button--primary'
        }
      ],
      null,
      2
    )}\n`,
    'utf8'
  );

  await writeFile(
    path.join(repoRoot, 'README.md'),
    ['# Demo App', '', 'A concise summary.', '', '![Preview](https://example.com/readme.png)'].join('\n'),
    'utf8'
  );

  await git.add('.');
  await git.commit('initial commit');
  const commitSha = await git.revparse(['HEAD']);
  assert(commitSha, 'expected commit sha');

  return {
    repoPath: repoRoot,
    commitSha,
    async cleanup() {
      await rm(repoRoot, { recursive: true, force: true });
    }
  };
}

export function buildRepositoryRecord(
  repoUrl: string,
  overrides: Partial<RepositoryRecord> = {}
): RepositoryRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'repo-1',
    name: overrides.name ?? 'Sample Repo',
    description: overrides.description ?? 'Sample description',
    repoUrl: overrides.repoUrl ?? repoUrl,
    dockerfilePath: overrides.dockerfilePath ?? '',
    updatedAt: overrides.updatedAt ?? now,
    ingestStatus: overrides.ingestStatus ?? 'pending',
    lastIngestedAt: overrides.lastIngestedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    ingestError: overrides.ingestError ?? null,
    ingestAttempts: overrides.ingestAttempts ?? 0,
    tags: overrides.tags ?? [],
    latestBuild: overrides.latestBuild ?? null,
    latestLaunch: overrides.latestLaunch ?? null,
    previewTiles: overrides.previewTiles ?? [],
    metadataStrategy: overrides.metadataStrategy ?? 'auto',
    launchEnvTemplates: overrides.launchEnvTemplates ?? []
  };
}

export function buildPipelineContext(
  repo: RepositoryRecord,
  overrides: Partial<IngestionPipelineContext> = {}
): IngestionPipelineContext {
  const base: IngestionPipelineContext = {
    repository: repo,
    jobContext: null,
    inlineQueueMode: false,
    workingDir: null,
    commitSha: null,
    packageMetadata: null,
    declaredTags: [],
    readmeMetadata: null,
    manifestPreviews: [],
    previewTiles: [],
    dockerfilePath: null,
    dockerTags: [],
    tagMap: new Map(),
    repositoryName: repo.name,
    repositoryDescription: repo.description,
    metadataStrategy: repo.metadataStrategy ?? 'auto',
    shouldAutofillMetadata: (repo.metadataStrategy ?? 'auto') !== 'explicit',
    stageMetrics: [],
    cleanupTasks: [],
    buildId: null,
    processingStartedAt: Date.now()
  };

  return Object.assign(base, overrides);
}
