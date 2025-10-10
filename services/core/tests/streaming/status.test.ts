import test from 'node:test';
import assert from 'node:assert/strict';
import type { FeatureFlags } from '../../src/config/featureFlags';

function buildFlags(enabled: boolean): FeatureFlags {
  return {
    streaming: {
      enabled,
      mirrors: {
        workflowRuns: false,
        workflowEvents: false,
        jobRuns: false,
        ingestion: false,
        coreEvents: true
      }
    }
  } satisfies FeatureFlags;
}

test('evaluateStreamingStatus includes publisher topic diagnostics and drop counters', async () => {
  const publishDiagnostics = {
    'apphub.core.events': {
      topic: 'apphub.core.events',
      lastSuccessAt: '2024-11-01T00:00:00.000Z',
      lastFailureAt: null,
      failureCount: 0,
      lastError: null
    }
  } satisfies Record<string, {
    topic: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    failureCount: number;
    lastError?: string | null;
  }>;

  const originalBrokerUrl = process.env.APPHUB_STREAM_BROKER_URL;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalEventsMode = process.env.APPHUB_EVENTS_MODE;
  const originalInlineFlag = process.env.APPHUB_ALLOW_INLINE_MODE;
  const originalDisableAnalytics = process.env.APPHUB_DISABLE_ANALYTICS;

  process.env.APPHUB_STREAM_BROKER_URL = 'redpanda:9092';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_DISABLE_ANALYTICS = 'true';

  const streamingStatusModule = await import('../../src/streaming/status');
  const {
    evaluateStreamingStatus,
    __setStreamingStatusTestOverrides
  } = (streamingStatusModule.default ?? streamingStatusModule) as typeof import('../../src/streaming/status');

  __setStreamingStatusTestOverrides({
    getMirrorDiagnostics: () => publishDiagnostics,
    isKafkaPublisherConfigured: () => true,
    getEventSchedulerSourceMetrics: async () => [
      {
        source: 'observatory.module',
        total: 10,
        throttled: 1,
        dropped: 2,
        failures: 0,
        averageLagMs: 120,
        lastLagMs: 80,
        maxLagMs: 240,
        lastEventAt: '2024-11-01T00:05:00.000Z'
      }
    ]
  });

  try {
    const status = await evaluateStreamingStatus(buildFlags(false));
    assert.ok(status.publisher);
    assert.equal(status.publisher?.configured, true);
    assert.equal(status.publisher?.topics.length, 1);
    assert.equal(status.publisher?.topics[0]?.topic, 'apphub.core.events');
    assert.equal(status.publisher?.sources.length, 1);
    const [sourceMetrics] = status.publisher?.sources ?? [];
    assert.ok(sourceMetrics);
    assert.equal(sourceMetrics.source, 'observatory.module');
    assert.equal(status.publisher?.summary.totalEvents, 10);
    assert.equal(status.publisher?.summary.totalDropped, 2);
    assert.equal(status.publisher?.summary.totalThrottled, 1);
  } finally {
    __setStreamingStatusTestOverrides();
    if (originalBrokerUrl === undefined) {
      delete process.env.APPHUB_STREAM_BROKER_URL;
    } else {
      process.env.APPHUB_STREAM_BROKER_URL = originalBrokerUrl;
    }
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
    if (originalEventsMode === undefined) {
      delete process.env.APPHUB_EVENTS_MODE;
    } else {
      process.env.APPHUB_EVENTS_MODE = originalEventsMode;
    }
    if (originalInlineFlag === undefined) {
      delete process.env.APPHUB_ALLOW_INLINE_MODE;
    } else {
      process.env.APPHUB_ALLOW_INLINE_MODE = originalInlineFlag;
    }
    if (originalDisableAnalytics === undefined) {
      delete process.env.APPHUB_DISABLE_ANALYTICS;
    } else {
      process.env.APPHUB_DISABLE_ANALYTICS = originalDisableAnalytics;
    }
  }
});
