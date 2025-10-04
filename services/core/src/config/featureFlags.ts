const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

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

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return fallback;
}

export function getFeatureFlags(): FeatureFlags {
  if (cachedFlags) {
    return cachedFlags;
  }
  const streamingEnabled = parseFlag(process.env.APPHUB_STREAMING_ENABLED, false);
  const mirrorFlags: StreamingMirrorFlags = {
    workflowRuns: parseFlag(process.env.APPHUB_STREAM_MIRROR_WORKFLOW_RUNS, false),
    workflowEvents: parseFlag(process.env.APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS, false),
    jobRuns: parseFlag(process.env.APPHUB_STREAM_MIRROR_JOB_RUNS, false),
    ingestion: parseFlag(process.env.APPHUB_STREAM_MIRROR_INGESTION, false),
    coreEvents: parseFlag(process.env.APPHUB_STREAM_MIRROR_CORE_EVENTS, false)
  };
  cachedFlags = {
    streaming: {
      enabled: streamingEnabled,
      mirrors: mirrorFlags
    }
  };
  return cachedFlags;
}

export function isStreamingEnabled(): boolean {
  return getFeatureFlags().streaming.enabled;
}

export function resetFeatureFlagsCache(): void {
  cachedFlags = null;
}
