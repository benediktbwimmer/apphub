import { z } from 'zod';
import { booleanVar, loadEnvConfig } from '@apphub/shared/envConfig';

export type StreamingMirrorFlags = {
  workflowRuns: boolean;
  workflowEvents: boolean;
  jobRuns: boolean;
  ingestion: boolean;
  coreEvents: boolean;
};

export type FeatureFlags = {
  streaming: {
    enabled: boolean;
    mirrors: StreamingMirrorFlags;
  };
};

let cachedFlags: FeatureFlags | null = null;

const featureFlagEnvSchema = z
  .object({
    APPHUB_STREAMING_ENABLED: booleanVar({ defaultValue: false }),
    APPHUB_STREAM_MIRROR_WORKFLOW_RUNS: booleanVar({ defaultValue: false }),
    APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS: booleanVar({ defaultValue: false }),
    APPHUB_STREAM_MIRROR_JOB_RUNS: booleanVar({ defaultValue: false }),
    APPHUB_STREAM_MIRROR_INGESTION: booleanVar({ defaultValue: false }),
    APPHUB_STREAM_MIRROR_CORE_EVENTS: booleanVar({ defaultValue: false })
  })
  .passthrough()
  .transform((env) => ({
    streaming: {
      enabled: env.APPHUB_STREAMING_ENABLED ?? false,
      mirrors: {
        workflowRuns: env.APPHUB_STREAM_MIRROR_WORKFLOW_RUNS ?? false,
        workflowEvents: env.APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS ?? false,
        jobRuns: env.APPHUB_STREAM_MIRROR_JOB_RUNS ?? false,
        ingestion: env.APPHUB_STREAM_MIRROR_INGESTION ?? false,
        coreEvents: env.APPHUB_STREAM_MIRROR_CORE_EVENTS ?? false
      }
    }
  }) satisfies FeatureFlags);

export function getFeatureFlags(): FeatureFlags {
  if (!cachedFlags) {
    cachedFlags = loadEnvConfig(featureFlagEnvSchema, { context: 'core:feature-flags' });
  }
  return cachedFlags;
}

export function isStreamingEnabled(): boolean {
  return getFeatureFlags().streaming.enabled;
}

export function resetFeatureFlagsCache(): void {
  cachedFlags = null;
}
