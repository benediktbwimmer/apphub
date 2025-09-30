import { DEFAULT_EVENT_QUEUE_NAME } from '@apphub/event-bus';

export const INGEST_QUEUE_NAME = process.env.INGEST_QUEUE_NAME ?? 'apphub_queue';
export const BUILD_QUEUE_NAME = process.env.BUILD_QUEUE_NAME ?? 'apphub_build_queue';
export const LAUNCH_QUEUE_NAME = process.env.LAUNCH_QUEUE_NAME ?? 'apphub_launch_queue';
export const WORKFLOW_QUEUE_NAME = process.env.WORKFLOW_QUEUE_NAME ?? 'apphub_workflow_queue';
export const ASSET_EVENT_QUEUE_NAME = process.env.ASSET_EVENT_QUEUE_NAME ?? 'apphub_asset_event_queue';
export const EXAMPLE_BUNDLE_QUEUE_NAME = process.env.EXAMPLE_BUNDLE_QUEUE_NAME ?? 'apphub_example_bundle_queue';
export const EVENT_QUEUE_NAME = process.env.APPHUB_EVENT_QUEUE_NAME ?? DEFAULT_EVENT_QUEUE_NAME;
export const EVENT_TRIGGER_QUEUE_NAME =
  process.env.APPHUB_EVENT_TRIGGER_QUEUE_NAME ?? 'apphub_event_trigger_queue';
export const EVENT_TRIGGER_JOB_NAME = 'apphub.event.trigger';
export const EVENT_TRIGGER_RETRY_JOB_NAME = 'apphub.event.trigger.retry';
export const EVENT_RETRY_JOB_NAME = 'apphub.event.retry';
export const WORKFLOW_RETRY_JOB_NAME = 'apphub.workflow.retry';

export const QUEUE_KEYS = {
  ingest: 'catalog:ingest',
  build: 'catalog:build',
  launch: 'catalog:launch',
  workflow: 'catalog:workflow',
  exampleBundle: 'catalog:example-bundle',
  event: 'catalog:event',
  eventTrigger: 'catalog:event-trigger'
} as const;
