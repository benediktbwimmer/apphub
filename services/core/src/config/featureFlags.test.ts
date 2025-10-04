import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  getFeatureFlags,
  resetFeatureFlagsCache
} from './featureFlags';

const FLAG_KEYS = [
  'APPHUB_STREAMING_ENABLED',
  'APPHUB_STREAM_MIRROR_WORKFLOW_RUNS',
  'APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS',
  'APPHUB_STREAM_MIRROR_JOB_RUNS',
  'APPHUB_STREAM_MIRROR_INGESTION',
  'APPHUB_STREAM_MIRROR_CORE_EVENTS'
] as const;

afterEach(() => {
  for (const key of FLAG_KEYS) {
    delete process.env[key];
  }
  resetFeatureFlagsCache();
});

describe('getFeatureFlags', () => {
  it('returns defaults when env vars are unset', () => {
    const flags = getFeatureFlags();
    assert.equal(flags.streaming.enabled, false);
    assert.deepEqual(flags.streaming.mirrors, {
      workflowRuns: false,
      workflowEvents: false,
      jobRuns: false,
      ingestion: false,
      coreEvents: false
    });
  });

  it('parses boolean-like values for streaming mirrors', () => {
    process.env.APPHUB_STREAMING_ENABLED = 'true';
    process.env.APPHUB_STREAM_MIRROR_WORKFLOW_RUNS = '1';
    process.env.APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS = 'true';
    process.env.APPHUB_STREAM_MIRROR_JOB_RUNS = 'yes';
    process.env.APPHUB_STREAM_MIRROR_INGESTION = 'on';
    process.env.APPHUB_STREAM_MIRROR_CORE_EVENTS = '0';

    const flags = getFeatureFlags();
    assert.equal(flags.streaming.enabled, true);
    assert.deepEqual(flags.streaming.mirrors, {
      workflowRuns: true,
      workflowEvents: true,
      jobRuns: true,
      ingestion: true,
      coreEvents: false
    });
  });
});
