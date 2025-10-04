const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export type FeatureFlags = {
  streaming: {
    enabled: boolean;
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
  cachedFlags = {
    streaming: {
      enabled: streamingEnabled
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
