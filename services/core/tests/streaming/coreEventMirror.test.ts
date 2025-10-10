import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { WorkflowEventRecord } from '../../src/db/types';

const STREAMING_ENV_KEYS = [
  'APPHUB_STREAMING_ENABLED',
  'APPHUB_STREAM_MIRROR_CORE_EVENTS',
  'APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS',
  'APPHUB_STREAM_MIRROR_WORKFLOW_RUNS',
  'APPHUB_STREAM_MIRROR_JOB_RUNS',
  'APPHUB_STREAM_MIRROR_INGESTION'
] as const;

async function withStreamingEnv(
  overrides: Partial<Record<(typeof STREAMING_ENV_KEYS)[number], string>>,
  fn: () => Promise<void> | void
): Promise<void> {
  const previousValues = new Map<string, string | undefined>();
  for (const key of STREAMING_ENV_KEYS) {
    previousValues.set(key, process.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        continue;
      }
      process.env[key] = value;
    }
    await fn();
  } finally {
    for (const key of STREAMING_ENV_KEYS) {
      const previous = previousValues.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

test('mirrorCustomWorkflowEvent mirrors custom envelopes when core streaming mirror is enabled', async (t) => {
  await withStreamingEnv(
    {
      APPHUB_STREAMING_ENABLED: 'true',
      APPHUB_STREAM_MIRROR_CORE_EVENTS: 'true',
      APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS: 'false',
      APPHUB_STREAM_MIRROR_WORKFLOW_RUNS: 'false',
      APPHUB_STREAM_MIRROR_JOB_RUNS: 'false',
      APPHUB_STREAM_MIRROR_INGESTION: 'false'
    },
    async () => {
      const publishMock = t.mock.fn(async () => true);

      const featureFlagsModule = await import('../../src/config/featureFlags');
      const { resetFeatureFlagsCache, getFeatureFlags } = (featureFlagsModule.default ??
        featureFlagsModule) as typeof import('../../src/config/featureFlags');
      resetFeatureFlagsCache();
      const flags = getFeatureFlags();
      assert.equal(flags.streaming.enabled, true);
      assert.equal(flags.streaming.mirrors.coreEvents, true);

      const coreEventMirrorModule = await import('../../src/streaming/coreEventMirror');
      const {
        mirrorCustomWorkflowEvent,
        __setCoreMirrorTestOverrides
      } = (coreEventMirrorModule.default ??
        coreEventMirrorModule) as typeof import('../../src/streaming/coreEventMirror');

      __setCoreMirrorTestOverrides({
        publishKafkaMirrorMessage: publishMock,
        isKafkaPublisherConfigured: () => true
      });

      const occurredAt = new Date().toISOString();
      const receivedAt = new Date().toISOString();
      const record: WorkflowEventRecord = {
        id: randomUUID(),
        type: 'observatory.sample.event',
        source: 'observatory.module',
        occurredAt,
        receivedAt,
        payload: { foo: 'bar', version: 2 },
        correlationId: 'corr-123',
        ttlMs: null,
        metadata: { channel: 'beta' }
      };

      try {
        mirrorCustomWorkflowEvent(record);
      } finally {
        __setCoreMirrorTestOverrides();
      }

      assert.equal(publishMock.mock.calls.length, 1);
      const [message] = publishMock.mock.calls[0].arguments;
      assert.equal(message.topic, 'apphub.core.events');
      assert.equal(message.key, record.id);
      assert.deepEqual(message.headers, {
        'x-apphub-event-type': record.type,
        'x-apphub-workflow-event-id': record.id
      });
      assert.deepEqual(message.value, {
        source: 'core',
        emittedAt: receivedAt,
        eventType: record.type,
        occurredAt,
        receivedAt,
        correlationId: record.correlationId,
        payloadJson: JSON.stringify(record.payload),
        metadataJson: JSON.stringify(record.metadata)
      });
    }
  );
});

test('mirrorCustomWorkflowEvent skips publishing when core mirror is disabled', async (t) => {
  await withStreamingEnv(
    {
      APPHUB_STREAMING_ENABLED: 'true',
      APPHUB_STREAM_MIRROR_CORE_EVENTS: 'false',
      APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS: 'false',
      APPHUB_STREAM_MIRROR_WORKFLOW_RUNS: 'false',
      APPHUB_STREAM_MIRROR_JOB_RUNS: 'false',
      APPHUB_STREAM_MIRROR_INGESTION: 'false'
    },
    async () => {
      const publishMock = t.mock.fn(async () => true);

      const featureFlagsModule = await import('../../src/config/featureFlags');
      const { resetFeatureFlagsCache, getFeatureFlags } = (featureFlagsModule.default ??
        featureFlagsModule) as typeof import('../../src/config/featureFlags');
      resetFeatureFlagsCache();
      const flags = getFeatureFlags();
      assert.equal(flags.streaming.enabled, true);
      assert.equal(flags.streaming.mirrors.coreEvents, false);

      const coreEventMirrorModule = await import('../../src/streaming/coreEventMirror');
      const {
        mirrorCustomWorkflowEvent,
        __setCoreMirrorTestOverrides
      } = (coreEventMirrorModule.default ??
        coreEventMirrorModule) as typeof import('../../src/streaming/coreEventMirror');

      __setCoreMirrorTestOverrides({
        publishKafkaMirrorMessage: publishMock,
        isKafkaPublisherConfigured: () => true
      });

      const occurredAt = new Date().toISOString();
      const receivedAt = new Date().toISOString();
      const record: WorkflowEventRecord = {
        id: randomUUID(),
        type: 'observatory.sample.event',
        source: 'observatory.module',
        occurredAt,
        receivedAt,
        payload: { foo: 'bar' },
        correlationId: null,
        ttlMs: null,
        metadata: null
      };

      try {
        mirrorCustomWorkflowEvent(record);
      } finally {
        __setCoreMirrorTestOverrides();
      }

      assert.equal(publishMock.mock.calls.length, 0);
    }
  );
});
