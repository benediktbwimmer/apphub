import { randomUUID } from 'node:crypto';

const CORE_URL = process.env.CORE_URL?.trim() || 'http://127.0.0.1:4000';
const TIMESTORE_URL = process.env.TIMESTORE_URL?.trim() || 'http://127.0.0.1:4200';
const DATASET_SLUG = process.env.STREAM_DATASET_WORKFLOW_EVENTS?.trim() || 'workflow_events_stream';
const STREAM_TIMEOUT_MS = Number(process.env.STREAM_VALIDATION_TIMEOUT_MS ?? 60_000);

/* eslint-disable no-console */
async function main(): Promise<void> {
  console.log('--- Streaming Replay Validation ---');
  console.log(`Core URL      : ${CORE_URL}`);
  console.log(`Timestore URL : ${TIMESTORE_URL}`);
  console.log(`Dataset       : ${DATASET_SLUG}`);
  console.log('');

  const readyz = await fetchJson(`${CORE_URL}/readyz`);
  const streaming = readyz.features?.streaming;
  if (!streaming || !streaming.enabled) {
    throw new Error('Core streaming feature is disabled (expected /readyz.features.streaming.enabled=true).');
  }
  if (!streaming.mirrors?.workflowEvents) {
    throw new Error('Workflow event mirror flag is disabled; enable APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS before running validation.');
  }
  console.log('✓ Core streaming reported enabled');

  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const envelope = {
    id: eventId,
    type: 'workflow.event.received',
    source: 'qa.streaming.validation',
    occurredAt,
    payload: {
      message: 'streaming validation payload',
      correlationKey: randomUUID()
    },
    metadata: {
      __apphubWorkflow: {
        workflowDefinitionId: `wf-${eventId.slice(0, 8)}`,
        workflowRunId: `run-${eventId.slice(9, 13)}`,
        workflowRunStepId: `step-${eventId.slice(14, 18)}`,
        jobRunId: `job-${eventId.slice(19, 23)}`,
        jobSlug: 'qa-validation',
        workflowRunKey: `validation-${eventId.slice(24)}`
      }
    }
  } satisfies Record<string, unknown>;

  const postResponse = await fetch(`${CORE_URL}/v1/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(envelope)
  });

  if (!postResponse.ok) {
    const body = await safeReadText(postResponse);
    throw new Error(`Core /v1/events returned HTTP ${postResponse.status}: ${body}`);
  }
  console.log(`✓ Published validation workflow event (id=${eventId})`);

  const deadline = Date.now() + STREAM_TIMEOUT_MS;
  const queryBody = {
    timeRange: {
      start: new Date(Date.now() - 5 * 60_000).toISOString(),
      end: new Date(Date.now() + 60_000).toISOString()
    },
    timestampColumn: 'emittedAt',
    limit: 200
  } satisfies Record<string, unknown>;

  while (Date.now() < deadline) {
    const queryResult = await fetchJson(
      `${TIMESTORE_URL}/datasets/${DATASET_SLUG}/query`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(queryBody)
      }
    );

    const rows: Array<Record<string, unknown>> = Array.isArray(queryResult.rows)
      ? (queryResult.rows as Array<Record<string, unknown>>)
      : [];
    const match = rows.find((row) => row.workflowEventId === eventId);
    if (match) {
      console.log('✓ Timestore ingested mirrored event');
      console.log(JSON.stringify(match, null, 2));
      console.log('✅ Streaming replay validation succeeded');
      return;
    }

    console.log('Waiting for ingestion...');
    await delay(2000);
  }

  throw new Error(`Timed out after ${STREAM_TIMEOUT_MS}ms waiting for dataset ${DATASET_SLUG} to contain event ${eventId}.`);
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(`Request to ${url} failed with ${response.status}: ${body}`);
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unavailable>';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('❌ Streaming validation failed');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
