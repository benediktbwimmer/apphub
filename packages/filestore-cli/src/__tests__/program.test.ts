import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { FilestoreEvent } from '@apphub/shared/filestoreEvents';
import { createInterface } from '../program';
import type { FilestoreClient } from '@apphub/filestore-client';

class StubClient implements Partial<FilestoreClient> {
  createDirectoryCalls: unknown[] = [];
  deleteNodeCalls: unknown[] = [];
  getNodeCalls: unknown[] = [];
  reconcileCalls: unknown[] = [];
  tailInvocations = 0;

  async createDirectory(payload: unknown): Promise<any> {
    this.createDirectoryCalls.push(payload);
    return { idempotent: false, journalEntryId: 1, node: null, result: {} };
  }

  async deleteNode(payload: unknown): Promise<any> {
    this.deleteNodeCalls.push(payload);
    return { idempotent: false, journalEntryId: 2, node: null, result: {} };
  }

  async getNodeByPath(payload: unknown): Promise<any> {
    this.getNodeCalls.push(payload);
    return { id: 1, path: 'datasets/demo' };
  }

  async enqueueReconciliation(payload: unknown): Promise<any> {
    this.reconcileCalls.push(payload);
    return { enqueued: true };
  }

  streamEvents(): AsyncIterable<FilestoreEvent> {
    this.tailInvocations += 1;
    const event: FilestoreEvent = {
      type: 'filestore.node.created',
      data: { nodeId: 1 }
    } as FilestoreEvent;

    async function* generator() {
      yield event;
    }

    return generator();
  }
}

let originalLog = console.log;
let captured: unknown[] = [];

afterEach(() => {
  console.log = originalLog;
  captured = [];
});

test('directories:create forwards arguments to client', async () => {
  const stub = new StubClient();
  console.log = (...args: unknown[]) => {
    captured.push(args);
  };
  const program = createInterface({
    clientFactory: () => stub as unknown as FilestoreClient
  });
  await program.parseAsync(['--json', 'directories:create', '3', 'datasets/demo', '--metadata', '{"owner":"cli"}'], {
    from: 'user'
  });
  assert.equal(stub.createDirectoryCalls.length, 1);
  const payload = stub.createDirectoryCalls[0] as { backendMountId: number; path: string; metadata: Record<string, unknown> };
  assert.equal(payload.backendMountId, 3);
  assert.equal(payload.path, 'datasets/demo');
  assert.deepEqual(payload.metadata, { owner: 'cli' });
  assert.equal(captured.length > 0, true);
});

test('nodes:delete passes recursive flag', async () => {
  const stub = new StubClient();
  console.log = () => undefined;
  const program = createInterface({ clientFactory: () => stub as unknown as FilestoreClient });
  await program.parseAsync(['nodes:delete', '4', 'datasets/tmp', '--recursive'], { from: 'user' });
  assert.equal(stub.deleteNodeCalls.length, 1);
  const payload = stub.deleteNodeCalls[0] as { backendMountId: number; path: string; recursive: boolean };
  assert.equal(payload.backendMountId, 4);
  assert.equal(payload.path, 'datasets/tmp');
  assert.equal(payload.recursive, true);
});

test('reconcile:enqueue validates options', async () => {
  const stub = new StubClient();
  console.log = () => undefined;
  const program = createInterface({ clientFactory: () => stub as unknown as FilestoreClient });
  await program.parseAsync([
    'reconcile:enqueue',
    '7',
    'datasets/reconcile',
    '--reason',
    'audit',
    '--detect-children'
  ], { from: 'user' });
  assert.equal(stub.reconcileCalls.length, 1);
  const payload = stub.reconcileCalls[0] as { backendMountId: number; reason: string; detectChildren: boolean };
  assert.equal(payload.backendMountId, 7);
  assert.equal(payload.reason, 'audit');
  assert.equal(payload.detectChildren, true);
});

test('events:tail iterates stream', async () => {
  const stub = new StubClient();
  console.log = (...args: unknown[]) => {
    captured.push(args);
  };
  const program = createInterface({ clientFactory: () => stub as unknown as FilestoreClient });
  await program.parseAsync(['events:tail', '--event', 'filestore.node.created'], { from: 'user' });
  assert.equal(stub.tailInvocations, 1);
  assert.equal(captured.length > 0, true);
});
