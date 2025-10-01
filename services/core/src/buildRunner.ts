import { type JsonValue } from './db/index';
import { registerJobHandler, type JobRunContext, type JobResult } from './jobs/runtime';
import { runDockerBuildJob } from './buildRunner/docker';
import { runKubernetesBuildJob } from './buildRunner/kubernetes';

function normalizeExecutionMode(value: string | undefined, fallback: 'docker' | 'kubernetes'): 'docker' | 'kubernetes' {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'docker' ? 'docker' : 'kubernetes';
}

function getBuildExecutionMode(): 'docker' | 'kubernetes' {
  return normalizeExecutionMode(process.env.APPHUB_BUILD_EXECUTION_MODE, 'kubernetes');
}

export async function runBuildJob(
  buildId: string,
  options: { jobContext?: JobRunContext } = {}
): Promise<JobResult> {
  const mode = getBuildExecutionMode();
  if (mode === 'docker') {
    return runDockerBuildJob(buildId, options);
  }
  return runKubernetesBuildJob(buildId, options);
}

function resolveBuildParameters(parameters: JsonValue): { buildId: string } {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('buildId parameter is required');
  }
  const value = (parameters as Record<string, JsonValue>).buildId;
  if (typeof value !== 'string') {
    throw new Error('buildId parameter is required');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('buildId parameter is required');
  }
  return { buildId: trimmed };
}

async function buildJobHandler(context: JobRunContext): Promise<JobResult> {
  const { buildId } = resolveBuildParameters(context.parameters);
  return runBuildJob(buildId, { jobContext: context });
}

registerJobHandler('repository-build', buildJobHandler);
