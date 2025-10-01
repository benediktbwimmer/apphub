import assert from 'node:assert/strict';
import http from 'node:http';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { CommanderError } from 'commander';
import { createTempDir } from './helpers';
import { createProgram } from '../src/index';

type RecordedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

async function startMockCoreServer(
  handler: (req: http.IncomingMessage, body: unknown, res: http.ServerResponse) => void
): Promise<{
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let parsed: unknown = undefined;
      if (raw.length > 0) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsed });
      handler(req, parsed, res);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function runProgram(program: ReturnType<typeof createProgram>, argv: string[]): Promise<void> {
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError && err.exitCode === 0) {
      return;
    }
    throw err;
  }
}

test('workflow triggers list command calls core API', { concurrency: false }, async (t) => {
  const server = await startMockCoreServer((req, _body, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/workflows/demo/triggers')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            workflow: { id: 'wf', slug: 'demo', name: 'Demo Workflow' },
            triggers: []
          }
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  t.after(async () => {
    await server.close();
  });

  const program = createProgram();
  program.exitOverride();

  const logMock = t.mock.method(console, 'log', () => {});
  const tableMock = t.mock.method(console, 'table', () => {});

  await runProgram(program, [
    'node',
    'apphub',
    'workflows',
    'triggers',
    'list',
    'demo',
    '--token',
    'test-token',
    '--core-url',
    server.url
  ]);

  assert.equal(server.requests.length, 1);
  const recorded = server.requests[0];
  assert.equal(recorded.method, 'GET');
  assert.equal(recorded.url, '/workflows/demo/triggers');
  assert.equal(recorded.headers.authorization, 'Bearer test-token');
  assert.equal(tableMock.mock.calls.length, 0);
  assert.ok(logMock.mock.calls.length >= 1);
});

test('workflow triggers create command posts definition payload', { concurrency: false }, async (t) => {
  const server = await startMockCoreServer((req, body, res) => {
    if (req.method === 'POST' && req.url === '/workflows/demo/triggers') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { id: 'trigger-1', status: 'active' } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  t.after(async () => {
    await server.close();
  });

  const dir = await createTempDir('apphub-cli-triggers-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const definitionPath = path.join(dir, 'trigger.yaml');
  await writeFile(
    definitionPath,
    [
      'eventType: timestore.partition.created',
      'name: Partition Created',
      'predicates:',
      '  - path: $.payload.dataset',
      '    operator: equals',
      '    value: test-dataset',
      ''
    ].join('\n'),
    'utf8'
  );

  const program = createProgram();
  program.exitOverride();

  const logMock = t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'table', () => {});

  await runProgram(program, [
    'node',
    'apphub',
    'workflows',
    'triggers',
    'create',
    'demo',
    '--file',
    definitionPath,
    '--token',
    'test-token',
    '--core-url',
    server.url,
    '--yes'
  ]);

  assert.equal(server.requests.length, 1);
  const recorded = server.requests[0];
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.url, '/workflows/demo/triggers');
  const body = recorded.body as Record<string, unknown>;
  assert.equal(body.eventType, 'timestore.partition.created');
  assert.ok(Array.isArray(body.predicates));
  assert.ok(logMock.mock.calls.length >= 1);
});
