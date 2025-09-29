const DEFAULT_NAMESPACE = 'apphub';
const DEFAULT_BUILDER_IMAGE = 'ghcr.io/apphub/builder:latest';
const DEFAULT_BUILDER_SERVICE_ACCOUNT = 'apphub-builder';
const DEFAULT_BUILD_TIMEOUT_SECONDS = 15 * 60;
const DEFAULT_JOB_TTL_SECONDS = 10 * 60;

export function getKubernetesNamespace(): string {
  const raw = process.env.APPHUB_K8S_NAMESPACE;
  if (!raw) {
    return DEFAULT_NAMESPACE;
  }
  const trimmed = raw.trim();
  return trimmed || DEFAULT_NAMESPACE;
}

export function getKubernetesBuilderImage(): string {
  const raw = process.env.APPHUB_K8S_BUILDER_IMAGE;
  if (!raw) {
    return DEFAULT_BUILDER_IMAGE;
  }
  const trimmed = raw.trim();
  return trimmed || DEFAULT_BUILDER_IMAGE;
}

export function getKubernetesBuilderImagePullPolicy(): string | undefined {
  const raw = process.env.APPHUB_K8S_BUILDER_IMAGE_PULL_POLICY;
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed || undefined;
}

export function getKubernetesBuilderServiceAccount(): string {
  const raw = process.env.APPHUB_K8S_BUILDER_SERVICE_ACCOUNT;
  if (!raw) {
    return DEFAULT_BUILDER_SERVICE_ACCOUNT;
  }
  const trimmed = raw.trim();
  return trimmed || DEFAULT_BUILDER_SERVICE_ACCOUNT;
}

export function getKubernetesBuildTimeoutSeconds(): number {
  const raw = process.env.APPHUB_K8S_BUILD_TIMEOUT_SECONDS;
  if (!raw) {
    return DEFAULT_BUILD_TIMEOUT_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BUILD_TIMEOUT_SECONDS;
  }
  return parsed;
}

export function getKubernetesBuildJobTtlSeconds(): number {
  const raw = process.env.APPHUB_K8S_BUILD_JOB_TTL_SECONDS;
  if (!raw) {
    return DEFAULT_JOB_TTL_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_JOB_TTL_SECONDS;
  }
  return parsed;
}
