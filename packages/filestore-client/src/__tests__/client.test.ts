import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { FilestoreEvent } from '@apphub/shared/filestoreEvents';
import { FilestoreClient } from '../client';

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const recordedRequests: RecordedRequest[] = [];
let baseUrl = '';
let server: http.Server;

before(async () => {
  server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end();
      return;
    }

    if (req.url === '/v1/directories' && req.method === 'POST') {
      const body = await readBody(req);
      recordedRequests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: {
            idempotent: false,
          journalEntryId: 42,
          node: {
            id: 10,
            backendMountId: 1,
            parentId: null,
            path: 'datasets/example',
            name: 'example',
            depth: 1,
            kind: 'directory',
            sizeBytes: 0,
            checksum: null,
            contentHash: null,
            metadata: {},
            state: 'active',
            version: 1,
            isSymlink: false,
            lastSeenAt: new Date().toISOString(),
            lastModifiedAt: null,
            consistencyState: 'active',
            consistencyCheckedAt: new Date().toISOString(),
            lastReconciledAt: null,
            lastDriftDetectedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            rollup: null
          },
            result: {}
          }
        })
      );
      return;
    }

    if (req.url?.startsWith('/v1/nodes/by-path') && req.method === 'GET') {
      recordedRequests.push({ method: req.method, url: req.url, headers: req.headers, body: null });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: {
            id: 99,
            backendMountId: 2,
            parentId: null,
            path: 'datasets/observatory',
            name: 'observatory',
            depth: 1,
            kind: 'directory',
            sizeBytes: 0,
            checksum: null,
            contentHash: null,
            metadata: {},
            state: 'active',
            version: 1,
            isSymlink: false,
            lastSeenAt: new Date().toISOString(),
            lastModifiedAt: null,
            consistencyState: 'active',
            consistencyCheckedAt: new Date().toISOString(),
            lastReconciledAt: null,
            lastDriftDetectedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            rollup: null
          }
        })
      );
      return;
    }

    if (req.url === '/v1/reconciliation' && req.method === 'POST') {
      const body = await readBody(req);
      recordedRequests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: { enqueued: true } }));
      return;
    }

    if (req.url === '/v1/events/stream' && req.method === 'GET') {
      recordedRequests.push({ method: req.method, url: req.url, headers: req.headers, body: null });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache'
      });
      const payload = JSON.stringify({ type: 'filestore.node.created', data: { nodeId: 7 } });
      res.write(`event: filestore.node.created\n`);
      res.write(`data: ${payload}\n\n`);
      setTimeout(() => {
        res.end();
      }, 10);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  if (address && typeof address === 'object') {
    baseUrl = `http://127.0.0.1:${address.port}`;
  } else {
    throw new Error('Failed to determine test server address');
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
});

function createClient() {
  return new FilestoreClient({
    baseUrl,
    token: 'test-token',
    defaultHeaders: {
      'x-custom-header': 'custom-value'
    },
    fetchTimeoutMs: 2000
  });
}

function resetRequests() {
  recordedRequests.length = 0;
}

test('createDirectory sends idempotency header and payload', async () => {
  resetRequests();
  const client = createClient();
  const result = await client.createDirectory({ backendMountId: 1, path: 'datasets/example' });
  assert.equal(result.idempotent, false);
  assert.equal(result.node?.path, 'datasets/example');
  assert.equal(recordedRequests.length, 1);
  const request = recordedRequests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/v1/directories');
  assert.ok(request.headers['authorization']);
  assert.equal(request.headers['x-custom-header'], 'custom-value');
  assert.match(request.headers['idempotency-key'] as string, /^[0-9a-f-]{36}$/i);
  assert.equal(request.body.backendMountId, 1);
  assert.equal(request.body.path, 'datasets/example');
});

test('getNodeByPath attaches query params', async () => {
  resetRequests();
  const client = createClient();
  const node = await client.getNodeByPath({ backendMountId: 5, path: 'datasets/observatory' });
  assert.equal(node.id, 99);
  const request = recordedRequests[0];
  assert.ok(request.url.includes('backendMountId=5'));
  assert.ok(request.url.includes('path=datasets%2Fobservatory'));
});

test('enqueueReconciliation posts body', async () => {
  resetRequests();
  const client = createClient();
  const result = await client.enqueueReconciliation({ backendMountId: 9, path: 'datasets/reconcile', reason: 'audit' });
  assert.deepEqual(result, { enqueued: true });
  const request = recordedRequests[0];
  assert.equal(request.body.backendMountId, 9);
  assert.equal(request.body.reason, 'audit');
});

test('streamEvents yields SSE messages', async () => {
  resetRequests();
  const client = createClient();
  const events: FilestoreEvent[] = [];
  for await (const event of client.streamEvents({ eventTypes: ['filestore.node.created'] })) {
    events.push(event);
    break;
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'filestore.node.created');
  assert.deepEqual(events[0].data, { nodeId: 7 });
});
