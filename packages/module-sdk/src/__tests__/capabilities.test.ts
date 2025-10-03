import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleCapabilities, mergeCapabilityOverrides, resolveModuleCapabilityConfig } from '../runtime/capabilities';
import { createFilestoreCapability } from '../capabilities/filestore';
import { createMetastoreCapability } from '../capabilities/metastore';
import { createEventBusCapability } from '../capabilities/eventBus';
import { createTimestoreCapability } from '../capabilities/timestore';
import { createCoreWorkflowsCapability } from '../capabilities/coreWorkflows';
import { CapabilityRequestError } from '../errors';

type FetchStubOptions = {
  headers?: Record<string, string>;
  stream?: ReadableStream<Uint8Array> | null;
};

function createFetchStub(status = 200, body: unknown = {}, options: FetchStubOptions = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    createFetchStub.lastCall = { input, init };
    const headers = new Headers(options.headers ?? {});
    const textPayload = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      body: options.stream ?? null,
      json: async () => body,
      text: async () => textPayload
    } as unknown as Response;
  }) as typeof fetch;
}

createFetchStub.lastCall = {} as { input?: RequestInfo | URL; init?: RequestInit };

test('resolveModuleCapabilityConfig maps settings and secrets references', () => {
  const resolved = resolveModuleCapabilityConfig(
    {
      filestore: {
        baseUrl: { $ref: 'settings.filestore.baseUrl' },
        backendMountId: { $ref: 'settings.filestore.backendId', fallback: 1 }
      },
      events: {
        baseUrl: { $ref: 'settings.core.baseUrl' },
        defaultSource: { $ref: 'settings.events.source' },
        token: { $ref: 'secrets.eventsToken', optional: true }
      }
    },
    {
      settings: {
        filestore: { baseUrl: 'https://filestore.local', backendId: 7 },
        core: { baseUrl: 'https://core.local' },
        events: { source: 'observatory.events' }
      },
      secrets: { eventsToken: 'token-xyz' }
    }
  );

  assert.equal(resolved.filestore?.baseUrl, 'https://filestore.local');
  assert.equal(resolved.filestore?.backendMountId, 7);
  assert.equal(resolved.events?.baseUrl, 'https://core.local');
  assert.equal(resolved.events?.defaultSource, 'observatory.events');
  assert.equal(resolved.events?.token, 'token-xyz');
});

test('resolveModuleCapabilityConfig applies fallbacks for missing references', () => {
  const resolved = resolveModuleCapabilityConfig(
    {
      filestore: {
        backendMountId: { $ref: 'settings.filestore.backendId', fallback: 99 }
      },
      coreHttp: {
        baseUrl: { $ref: 'settings.core.baseUrl' }
      }
    },
    {
      settings: { filestore: {}, core: { baseUrl: 'https://core.local' } },
      secrets: {}
    }
  );

  assert.equal(resolved.filestore?.backendMountId, 99);
  assert.equal(resolved.coreHttp?.baseUrl, 'https://core.local');
});

test('createModuleCapabilities builds defaults and allows overrides', async () => {
  const fetchImpl = createFetchStub(200, {
    data: {
      idempotent: false,
      node: { id: 42, path: 'datasets/example/file.csv', backendMountId: 1, parentId: null, name: 'file.csv', depth: 1, kind: 'file', sizeBytes: 10, checksum: 'abc', contentHash: null, metadata: {}, state: 'active', version: 1, isSymlink: false, lastSeenAt: new Date().toISOString(), lastModifiedAt: null, consistencyState: 'consistent', consistencyCheckedAt: new Date().toISOString(), lastReconciledAt: null, lastDriftDetectedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, rollup: null },
      result: { path: 'datasets/example/file.csv' }
    }
  });
  const capabilities = createModuleCapabilities({
    filestore: {
      baseUrl: 'https://filestore.local',
      backendMountId: 1,
      fetchImpl
    }
  });

  assert.ok(capabilities.filestore, 'filestore capability is defined');

  const uploadResult = await capabilities.filestore?.uploadFile({
    path: 'datasets/example/file.csv',
    content: 'hello-world'
  });

  const callInit = createFetchStub.lastCall.init;
  assert.ok(callInit, 'fetch called for upload');
  assert.equal(callInit?.method, 'POST');
  assert.equal(uploadResult?.nodeId, 42);

  const overrideCapabilities = createModuleCapabilities(
    {
      filestore: {
        baseUrl: 'https://filestore.local',
        backendMountId: 1,
        fetchImpl
      }
    },
    {
      filestore: null
    }
  );
  assert.equal(overrideCapabilities.filestore, undefined, 'filestore disabled via override');

  let factoryCalled = false;
  const functionalOverride = createModuleCapabilities(
    {
      filestore: {
        baseUrl: 'https://filestore.local',
        backendMountId: 2,
        fetchImpl
      }
    },
    {
      filestore: (config, createDefault) => {
        factoryCalled = true;
        const base = createDefault();
        return base;
      }
    }
  );
  assert.ok(factoryCalled, 'override factory invoked');
  assert.ok(functionalOverride.filestore);
});

test('capability errors bubble as CapabilityRequestError', async () => {
  const fetchImpl = createFetchStub(500, { error: 'boom' });
  const filestore = createFilestoreCapability({
    baseUrl: 'https://filestore.local',
    backendMountId: 1,
    fetchImpl
  });
  await assert.rejects(
    () =>
      filestore.uploadFile({
        path: 'datasets/example/file.csv',
        content: 'hello'
      }),
    (error) => {
      assert.ok(error instanceof CapabilityRequestError);
      assert.equal(error.status, 500);
      return true;
    }
  );
});

test('mergeCapabilityOverrides prefers the latest entry', () => {
  const merged = mergeCapabilityOverrides(
    { filestore: null },
    { filestore: undefined },
    { filestore: (config, createDefault) => createDefault() }
  );
  assert.equal(typeof merged.filestore, 'function');
});

test('downloadFile returns stream metadata', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('hello'));
      controller.close();
    }
  });

  const fetchImpl = createFetchStub(
    200,
    {},
    {
      headers: {
        'content-length': '5',
        'x-filestore-checksum': 'abc123',
        'content-type': 'text/plain'
      },
      stream
    }
  );

  const filestore = createFilestoreCapability({
    baseUrl: 'https://filestore.local',
    backendMountId: 1,
    fetchImpl
  });

  const result = await filestore.downloadFile({ nodeId: 7 });
  assert.equal(result.contentLength, 5);
  assert.equal(result.checksum, 'abc123');

  let received = '';
  if ((result.stream as ReadableStream<Uint8Array>).getReader) {
    const reader = (result.stream as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += decoder.decode(value, { stream: true });
    }
  } else {
    for await (const chunk of result.stream as NodeJS.ReadableStream) {
      received += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    }
  }

  assert.equal(received, 'hello');
});

test('findBackendMountByKey resolves matching mount', async () => {
  const fetchImpl = createFetchStub(200, {
    data: {
      mounts: [
        {
          id: 9,
          mountKey: 'observatory-event-driven-s3',
          backendKind: 's3',
          state: 'active',
          accessMode: 'rw'
        }
      ],
      pagination: {
        total: 1,
        limit: 100,
        offset: 0,
        nextOffset: null
      }
    }
  });

  const filestore = createFilestoreCapability({
    baseUrl: 'https://filestore.local',
    backendMountId: 1,
    fetchImpl
  });

  const mount = await filestore.findBackendMountByKey('observatory-event-driven-s3');
  assert.ok(mount);
  assert.equal(mount?.id, 9);
});

test('timestore ingestRecords returns inline result', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const fetchImpl = createFetchStub(201, {
    mode: 'inline',
    dataset: {
      id: 'ds-1',
      slug: 'observatory-timeseries',
      name: 'Observatory Time Series'
    },
    manifest: { id: 'mf-1' }
  });

  const timestore = createTimestoreCapability({
    baseUrl: 'https://timestore.local',
    fetchImpl
  });

  const result = await timestore.ingestRecords({
    datasetSlug: 'observatory-timeseries',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'value', type: 'double' }
      ]
    },
    partition: {
      key: { instrumentId: 'instrument-alpha' },
      timeRange: {
        start: '2025-01-01T00:00:00Z',
        end: '2025-01-01T00:59:59Z'
      }
    },
    rows: [
      { timestamp: '2025-01-01T00:00:00Z', value: 42 }
    ]
  });

  assert.equal(result.mode, 'inline');
  assert.equal(result.dataset?.slug, 'observatory-timeseries');
  assert.equal(result.manifest?.id, 'mf-1');
  const url = String(createFetchStub.lastCall.input);
  assert.ok(url.endsWith('/v1/datasets/observatory-timeseries/ingest'));
});

test('timestore queryDataset posts query payload', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const fetchImpl = createFetchStub(200, {
    rows: [{ value: 1 }],
    columns: ['value'],
    mode: 'raw'
  });

  const timestore = createTimestoreCapability({
    baseUrl: 'https://timestore.local',
    fetchImpl
  });

  const result = await timestore.queryDataset({
    datasetSlug: 'observatory-timeseries',
    timeRange: {
      start: '2025-01-01T00:00:00Z',
      end: '2025-01-01T00:59:59Z'
    },
    columns: ['value']
  });

  assert.equal(result.rows.length, 1);
  const body = createFetchStub.lastCall.init?.body;
  assert.ok(typeof body === 'string' && body.includes('"columns"'));
});

test('timestore getDataset resolves by slug', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const fetchImpl = createFetchStub(200, {
    datasets: [
      {
        id: 'ds-1',
        slug: 'observatory-timeseries',
        name: 'Observatory Time Series'
      }
    ],
    nextCursor: null
  });

  const timestore = createTimestoreCapability({
    baseUrl: 'https://timestore.local',
    fetchImpl
  });

  const dataset = await timestore.getDataset({ datasetSlug: 'observatory-timeseries' });
  assert.equal(dataset?.slug, 'observatory-timeseries');
  const url = String(createFetchStub.lastCall.input);
  assert.ok(url.includes('/admin/datasets'));
});

test('timestore getDataset returns null for missing dataset', async () => {
  const fetchImpl = createFetchStub(404, { error: 'not found' });
  const timestore = createTimestoreCapability({
    baseUrl: 'https://timestore.local',
    fetchImpl
  });

  const dataset = await timestore.getDataset({ datasetSlug: 'missing-dataset' });
  assert.equal(dataset, null);
});

test('event bus publish includes optional attributes and close resolves', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const fetchImpl = createFetchStub(200, {});
  const eventBus = createEventBusCapability({
    baseUrl: 'https://events.local',
    defaultSource: 'module-default',
    fetchImpl
  });

  const occurredAt = new Date('2025-01-01T00:00:00Z');
  await eventBus.publish({
    type: 'observatory.dashboard.updated',
    payload: { ok: true },
    occurredAt,
    metadata: { region: 'west' },
    correlationId: 'corr-1',
    ttlSeconds: 120,
    id: 'event-1',
    source: 'module-override'
  });

  const init = createFetchStub.lastCall.init;
  assert.ok(init?.method === 'POST');
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  assert.equal(body.id, 'event-1');
  assert.equal(body.source, 'module-override');
  assert.equal(body.correlationId, 'corr-1');
  assert.equal(body.ttlSeconds, 120);
  assert.equal(body.occurredAt, occurredAt.toISOString());

  await eventBus.close();
});

test('metastore getRecord returns metadata and version', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const fetchImpl = createFetchStub(200, {
    data: {
      metadata: { foo: 'bar' },
      version: 3
    }
  });

  const metastore = createMetastoreCapability({
    baseUrl: 'https://metastore.local',
    namespace: 'observatory.calibrations',
    fetchImpl
  });

  const result = await metastore.getRecord({ key: ' calibration:alpha ' });
  assert.ok(result);
  assert.equal(result?.metadata.foo, 'bar');
  assert.equal(result?.version, 3);
});

test('metastore getRecord returns null when record missing', async () => {
  const fetchImpl = createFetchStub(404, { error: 'not found' });
  const metastore = createMetastoreCapability({
    baseUrl: 'https://metastore.local',
    namespace: 'observatory.calibrations',
    fetchImpl
  });

  const result = await metastore.getRecord({ key: 'missing-record' });
  assert.equal(result, null);
});

test('metastore searchRecords maps results', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const fetchImpl = createFetchStub(200, {
    data: {
      records: [
        { key: 'record-1', metadata: { foo: 'bar' }, version: 1 },
        { key: 'record-2', metadata: { baz: 2 }, version: null }
      ]
    }
  });

  const metastore = createMetastoreCapability({
    baseUrl: 'https://metastore.local',
    namespace: 'observatory.calibrations',
    fetchImpl
  });

  const result = await metastore.searchRecords({ limit: 2 });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].key, 'record-1');
  assert.equal(result.records[1].metadata.baz, 2);
});

test('core workflows capability composes workflow API calls', async () => {
  createFetchStub.lastCall = {} as typeof createFetchStub.lastCall;
  const listFetch = createFetchStub(200, { data: { partitions: [] } });
  const workflows = createCoreWorkflowsCapability({
    baseUrl: 'https://core.local',
    token: () => 'secret-token',
    fetchImpl: listFetch
  });

  await workflows.listAssetPartitions({
    workflowSlug: 'observatory-minute-ingest',
    assetId: 'observatory.timeseries.timestore',
    lookback: 90
  });

  const listCall = createFetchStub.lastCall;
  const listUrl = new URL(listCall.input as string);
  assert.equal(
    listUrl.pathname,
    '/workflows/observatory-minute-ingest/assets/observatory.timeseries.timestore/partitions'
  );
  assert.equal(listUrl.searchParams.get('lookback'), '90');
  const listHeaders = new Headers(listCall.init?.headers as HeadersInit);
  assert.equal(listHeaders.get('authorization'), 'Bearer secret-token');
  assert.equal(listCall.init?.method, 'GET');

  const enqueueFetch = createFetchStub(200, { data: { id: 'run-123' } });
  const enqueueCapability = createCoreWorkflowsCapability({
    baseUrl: 'https://core.local',
    token: 'static-token',
    fetchImpl: enqueueFetch
  });

  await enqueueCapability.enqueueWorkflowRun({
    workflowSlug: 'observatory-minute-ingest',
    partitionKey: 'instrument=alpha|window=2025-01-01T00:00',
    parameters: { minute: '2025-01-01T00:00' },
    runKey: 'plan-1-alpha',
    triggeredBy: 'observatory-calibration-reprocessor',
    idempotencyKey: 'key-123'
  });

  const enqueueCall = createFetchStub.lastCall;
  assert.equal(enqueueCall.init?.method, 'POST');
  const enqueueHeaders = new Headers(enqueueCall.init?.headers as HeadersInit);
  assert.equal(enqueueHeaders.get('authorization'), 'Bearer static-token');
  assert.equal(enqueueHeaders.get('idempotency-key'), 'key-123');
  const enqueueBody = typeof enqueueCall.init?.body === 'string' ? JSON.parse(enqueueCall.init.body as string) : {};
  assert.equal(enqueueBody.partitionKey, 'instrument=alpha|window=2025-01-01T00:00');
  assert.equal(enqueueBody.runKey, 'plan-1-alpha');
  assert.equal(enqueueBody.triggeredBy, 'observatory-calibration-reprocessor');

  const runFetch = createFetchStub(200, { data: { id: 'run-123', status: 'running' } });
  const runCapability = createCoreWorkflowsCapability({
    baseUrl: 'https://core.local',
    token: () => 'secret-token',
    fetchImpl: runFetch
  });

  await runCapability.getWorkflowRun({ runId: 'run-123' });
  const runCall = createFetchStub.lastCall;
  assert.equal(runCall.init?.method, 'GET');
  const runUrl = new URL(runCall.input as string);
  assert.equal(runUrl.pathname, '/workflow-runs/run-123');
});
