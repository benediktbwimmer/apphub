import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleCapabilities, mergeCapabilityOverrides } from '../runtime/capabilities';
import { createFilestoreCapability } from '../capabilities/filestore';
import { CapabilityRequestError } from '../errors';

function createFetchStub(status = 200, body: unknown = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    createFetchStub.lastCall = { input, init };
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body)
    } as Response;
  }) as typeof fetch;
}

createFetchStub.lastCall = {} as { input?: RequestInfo | URL; init?: RequestInit };

test('createModuleCapabilities builds defaults and allows overrides', async () => {
  const fetchImpl = createFetchStub(200, { data: { node: { id: 42 }, path: 'datasets/example/file.csv' } });
  const capabilities = createModuleCapabilities({
    filestore: {
      baseUrl: 'https://filestore.local',
      backendMountId: 1,
      fetchImpl
    }
  });

  assert.ok(capabilities.filestore, 'filestore capability is defined');

  await capabilities.filestore?.uploadFile({
    path: 'datasets/example/file.csv',
    content: 'hello-world'
  });

  const callInit = createFetchStub.lastCall.init;
  assert.ok(callInit, 'fetch called for upload');
  assert.equal(callInit?.method, 'POST');

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
