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
    APPHUB_STREAM_MIRROR_CORE_EVENTS: booleanVar({ defaultValue: false }),
    APPHUB_STREAM_BROKER_URL: z.string().optional()
  })
  .passthrough()
  .transform((env) => {
    const brokerPresent = Boolean((env.APPHUB_STREAM_BROKER_URL ?? process.env.APPHUB_STREAM_BROKER_URL ?? '').trim());
    const streamingEnabled = env.APPHUB_STREAMING_ENABLED ?? brokerPresent;

    return {
      streaming: {
        enabled: streamingEnabled,
        mirrors: {
          workflowRuns: env.APPHUB_STREAM_MIRROR_WORKFLOW_RUNS ?? streamingEnabled,
          workflowEvents: env.APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS ?? streamingEnabled,
          jobRuns: env.APPHUB_STREAM_MIRROR_JOB_RUNS ?? streamingEnabled,
          ingestion: env.APPHUB_STREAM_MIRROR_INGESTION ?? false,
          coreEvents: env.APPHUB_STREAM_MIRROR_CORE_EVENTS ?? false
        }
      }
    } satisfies FeatureFlags;
  });

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
