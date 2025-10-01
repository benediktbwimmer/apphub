import { spawn } from 'node:child_process';
import {
  appendBuildLog,
  completeBuild,
  getRepositoryById,
  startBuild,
  type JsonValue
} from '../db/index';
import { type JobRunContext, type JobResult } from '../jobs/runtime';
import {
  getKubernetesBuilderImage,
  getKubernetesBuilderImagePullPolicy,
  getKubernetesBuilderServiceAccount,
  getKubernetesBuildJobTtlSeconds,
  getKubernetesBuildTimeoutSeconds,
  getKubernetesNamespace
} from '../kubernetes/config';
import { applyManifest, deleteResource, runKubectl } from '../kubernetes/kubectl';
import { buildResourceName } from '../kubernetes/naming';
import { buildImageTag, log } from './utils';

function collectBuilderEnv(
  buildId: string,
  repository: { id: string; repoUrl: string; dockerfilePath: string },
  pending: { commitSha: string | null; gitBranch: string | null; gitRef: string | null },
  imageTag: string
): Array<{ name: string; value: string }> {
  const envVars: Array<{ name: string; value: string }> = [
    { name: 'APPHUB_BUILD_ID', value: buildId },
    { name: 'APPHUB_REPOSITORY_ID', value: repository.id },
    { name: 'APPHUB_REPOSITORY_URL', value: repository.repoUrl },
    { name: 'APPHUB_DOCKERFILE_PATH', value: repository.dockerfilePath },
    { name: 'APPHUB_BUILD_IMAGE_TAG', value: imageTag }
  ];

  if (pending.commitSha) {
    envVars.push({ name: 'APPHUB_COMMIT_SHA', value: pending.commitSha });
  }
  if (pending.gitBranch) {
    envVars.push({ name: 'APPHUB_GIT_BRANCH', value: pending.gitBranch });
  }
  if (pending.gitRef) {
    envVars.push({ name: 'APPHUB_GIT_REF', value: pending.gitRef });
  }

  const registryEndpoint = process.env.APPHUB_K8S_REGISTRY_ENDPOINT;
  if (registryEndpoint) {
    envVars.push({ name: 'APPHUB_REGISTRY_ENDPOINT', value: registryEndpoint });
  }
  const registryPushSecret = process.env.APPHUB_K8S_REGISTRY_SECRET;
  if (registryPushSecret) {
    envVars.push({ name: 'APPHUB_REGISTRY_SECRET', value: registryPushSecret });
  }
  const buildkitAddr = process.env.APPHUB_K8S_BUILDKIT_ADDRESS;
  if (buildkitAddr) {
    envVars.push({ name: 'APPHUB_BUILDKIT_ADDRESS', value: buildkitAddr });
  }
  return envVars;
}

function startLogStream(jobName: string, namespace: string, onChunk: (chunk: string) => void) {
  const child = spawn('kubectl', ['logs', '-f', `job/${jobName}`, '--namespace', namespace], {
    env: process.env
  });

  child.stdout.on('data', (chunk) => {
    onChunk(chunk.toString());
  });

  child.stderr.on('data', (chunk) => {
    onChunk(chunk.toString());
  });

  const completion = new Promise<void>((resolve) => {
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });

  return {
    stop: () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
    completion
  };
}

export async function runKubernetesBuildJob(
  buildId: string,
  options: { jobContext?: JobRunContext } = {}
): Promise<JobResult> {
  const jobContext = options.jobContext ?? null;
  const startedAt = Date.now();

  const pending = await startBuild(buildId);
  if (!pending) {
    log('No build to start or already handled', { buildId });
    const metrics: Record<string, JsonValue> = {
      buildId,
      status: 'skipped'
    };
    if (jobContext) {
      await jobContext.update({ metrics });
    }
    return {
      status: 'succeeded',
      result: { buildId, skipped: true },
      metrics
    };
  }

  const repository = await getRepositoryById(pending.repositoryId);
  if (!repository) {
    const message = 'Repository metadata no longer available. Build aborted.';
    await completeBuild(buildId, 'failed', {
      logs: pending.logs ?? '',
      errorMessage: message,
      commitSha: pending.commitSha,
      gitBranch: pending.gitBranch,
      gitRef: pending.gitRef
    });
    const metrics: Record<string, JsonValue> = {
      buildId,
      repositoryId: pending.repositoryId,
      status: 'failed'
    };
    if (jobContext) {
      await jobContext.update({ metrics });
    }
    return {
      status: 'failed',
      errorMessage: message,
      metrics
    };
  }

  const namespace = getKubernetesNamespace();
  const jobName = buildResourceName('apphub-build', buildId, repository.id);
  const builderImage = getKubernetesBuilderImage();
  const imageTag = buildImageTag(repository.id, pending.commitSha ?? null);
  const combinedLabels = {
    'apphub.io/build-id': buildId,
    'apphub.io/repository-id': repository.id
  } satisfies Record<string, string>;
  const jobTtlSeconds = getKubernetesBuildJobTtlSeconds();

  const manifest = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace,
      labels: combinedLabels
    },
    spec: {
      ttlSecondsAfterFinished: jobTtlSeconds > 0 ? jobTtlSeconds : undefined,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: combinedLabels
        },
        spec: {
          restartPolicy: 'Never',
          serviceAccountName: getKubernetesBuilderServiceAccount(),
          containers: [
            {
              name: 'apphub-builder',
              image: builderImage,
              imagePullPolicy: getKubernetesBuilderImagePullPolicy(),
              env: collectBuilderEnv(buildId, repository, pending, imageTag)
            }
          ]
        }
      }
    }
  } satisfies Record<string, unknown>;

  const startLine = `Scheduling build job ${jobName} in namespace ${namespace}...\n`;
  let combinedLogs = pending.logs ?? '';
  combinedLogs += startLine;
  await appendBuildLog(buildId, startLine);

  let finalResult: JobResult = {
    status: 'failed',
    errorMessage: 'build failed'
  };

  let appendQueue: Promise<unknown> = Promise.resolve();
  let stream: { stop: () => void; completion: Promise<void> } | null = null;

  try {
    await deleteResource('job', jobName, namespace, ['--ignore-not-found', '--wait=false']);

    const applyResult = await applyManifest(manifest, namespace);
    if (applyResult.exitCode !== 0) {
      combinedLogs += `${applyResult.stderr}\n`;
      await completeBuild(buildId, 'failed', {
        logs: combinedLogs,
        errorMessage: applyResult.stderr || 'Failed to submit build job',
        commitSha: pending.commitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      const metrics: Record<string, JsonValue> = {
        buildId,
        repositoryId: repository.id,
        status: 'failed'
      };
      if (jobContext) {
        await jobContext.update({ metrics });
      }
      finalResult = {
        status: 'failed',
        errorMessage: applyResult.stderr || 'Failed to submit build job',
        metrics
      };
      return finalResult;
    }

    stream = startLogStream(jobName, namespace, (chunk) => {
      if (!chunk) {
        return;
      }
      combinedLogs += chunk;
      appendQueue = appendQueue.then(() => appendBuildLog(buildId, chunk).catch(() => undefined));
    });

    const waitResult = await runKubectl([
      'wait',
      '--for=condition=complete',
      `job/${jobName}`,
      '--namespace',
      namespace,
      `--timeout=${getKubernetesBuildTimeoutSeconds()}s`
    ]);

    stream.stop();
    await stream.completion;
    await appendQueue;

    const durationMs = Date.now() - startedAt;

    if (waitResult.exitCode === 0) {
      await completeBuild(buildId, 'succeeded', {
        logs: combinedLogs,
        imageTag,
        errorMessage: '',
        commitSha: pending.commitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      const metrics: Record<string, JsonValue> = {
        buildId,
        repositoryId: repository.id,
        status: 'succeeded',
        durationMs,
        imageTag
      };
      if (pending.commitSha) {
        metrics.commitSha = pending.commitSha;
      }
      if (jobContext) {
        await jobContext.update({ metrics });
      }
      log('Kubernetes build job completed', { buildId, jobName, namespace, imageTag });
      finalResult = {
        status: 'succeeded',
        result: {
          buildId,
          repositoryId: repository.id,
          imageTag,
          commitSha: pending.commitSha ?? null
        },
        metrics
      };
    } else {
      const errorMessage = waitResult.stderr || 'Kubernetes build job failed';
      combinedLogs += `${errorMessage}\n`;
      await completeBuild(buildId, 'failed', {
        logs: combinedLogs,
        errorMessage,
        commitSha: pending.commitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      const metrics: Record<string, JsonValue> = {
        buildId,
        repositoryId: repository.id,
        status: 'failed',
        durationMs
      };
      if (pending.commitSha) {
        metrics.commitSha = pending.commitSha;
      }
      if (jobContext) {
        await jobContext.update({ metrics });
      }
      log('Kubernetes build job failed', { buildId, jobName, namespace, error: errorMessage.trim() });
      finalResult = {
        status: 'failed',
        errorMessage,
        metrics
      };
    }
  } finally {
    try {
      await deleteResource('job', jobName, namespace, ['--ignore-not-found', '--wait=false']);
    } catch (err) {
      log('Failed to cleanup build job', { buildId, jobName, error: (err as Error).message });
    }
  }

  return finalResult;
}
