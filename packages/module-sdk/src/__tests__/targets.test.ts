import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobHandler, createService } from '../targets';
import { noopLogger } from '../logger';

test('createJobHandler enforces required capabilities before invoking handler', async () => {
  let invoked = false;
  const job = createJobHandler({
    name: 'enforce-capabilities',
    requires: ['filestore'],
    handler: async (context) => {
      invoked = true;
      return context.capabilities.filestore;
    }
  });

  await assert.rejects(
    job.handler({
      module: { name: 'example', version: '1.0.0' },
      settings: {},
      secrets: {},
      capabilities: {},
      logger: noopLogger,
      job: { name: 'example-job', version: '1.0.0' },
      parameters: {}
    } as any) as Promise<unknown>,
    /job enforce-capabilities requires capability "filestore"/i
  );
  assert.equal(invoked, false, 'handler should not be invoked when capability is missing');

  const context: any = {
    module: { name: 'example', version: '1.0.0' },
    settings: {},
    secrets: {},
    capabilities: {},
    logger: noopLogger,
    job: { name: 'example-job', version: '1.0.0' },
    parameters: {}
  };

  context.capabilities.filestore = {
    ensureDirectory: async () => {},
    uploadFile: async () => ({ nodeId: 1, path: 'foo', idempotent: true }),
    getNodeByPath: async () =>
      ({
        id: 1,
        backendMountId: 1,
        parentId: null,
        path: 'foo',
        name: 'foo',
        depth: 1,
        kind: 'file',
        sizeBytes: null,
        checksum: null,
        contentHash: null,
        metadata: {},
        state: 'active',
        version: 1,
        isSymlink: false,
        lastSeenAt: new Date().toISOString(),
        lastModifiedAt: null,
        consistencyState: 'consistent',
        consistencyCheckedAt: new Date().toISOString(),
        lastReconciledAt: null,
        lastDriftDetectedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        rollup: null
      }) as any,
    listNodes: async () => ({ nodes: [], total: 0, limit: 0, offset: 0, nextOffset: null }),
    copyNode: async () => ({ idempotent: true, node: null, result: {} }),
    moveNode: async () => ({ idempotent: true, node: null, result: {} }),
    deleteNode: async () => ({ idempotent: true, node: null, result: {} }),
    downloadFile: async () => ({
      stream: null as any,
      status: 200,
      contentLength: null,
      totalSize: null,
      checksum: null,
      contentHash: null,
      contentType: null,
      lastModified: null,
      headers: {}
    }),
    findBackendMountByKey: async () => null
  };

  await job.handler(context);
  assert.equal(invoked, true, 'handler invoked when capability is present');
});

test('createService enforces required capabilities', async () => {
  const service = createService({
    name: 'dashboard',
    requires: ['events.audit'],
    handler: async (context) => ({
      async start() {
        const audit = (context.capabilities.events as Record<string, { publish: () => Promise<void>; close: () => Promise<void> }>).audit;
        await audit.publish();
      }
    })
  });

  await assert.rejects(
    service.handler({
      module: { name: 'module', version: '1.0.0' },
      settings: {},
      secrets: {},
      capabilities: {},
      logger: noopLogger,
      service: { name: 'dashboard', version: '1.0.0' }
    } as any) as Promise<unknown>,
    /service dashboard requires capability "events\.audit"/i
  );

  const context = {
    module: { name: 'module', version: '1.0.0' },
    settings: {},
    secrets: {},
    capabilities: {
      events: {
        audit: {
          publish: async () => {},
          close: async () => {}
        }
      }
    },
    logger: noopLogger,
    service: { name: 'dashboard', version: '1.0.0' }
  };

  const lifecycle = await service.handler(context as any);
  await lifecycle.start?.();
});
