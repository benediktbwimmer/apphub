import type { FeatureFlags } from '../config/featureFlags';

export type StreamingStatus = {
  enabled: boolean;
  state: 'disabled' | 'ready' | 'unconfigured';
  reason: string | null;
  brokerConfigured: boolean;
};

export function evaluateStreamingStatus(flags: FeatureFlags): StreamingStatus {
  if (!flags.streaming.enabled) {
    return {
      enabled: false,
      state: 'disabled',
      reason: null,
      brokerConfigured: false
    };
  }

  const brokerUrl = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim();
  if (!brokerUrl) {
    return {
      enabled: true,
      state: 'unconfigured',
      reason: 'APPHUB_STREAM_BROKER_URL is not set',
      brokerConfigured: false
    };
  }

  return {
    enabled: true,
    state: 'ready',
    reason: null,
    brokerConfigured: true
  };
}
