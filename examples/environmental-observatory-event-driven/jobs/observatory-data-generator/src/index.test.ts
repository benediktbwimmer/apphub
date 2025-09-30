import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

const directories: Array<Record<string, unknown>> = [];
const uploads: Array<Record<string, unknown>> = [];

class StubFilestoreClientError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

class StubFilestoreClient {
  constructor(options: Record<string, unknown>) {
    Object.assign(this, { options });
  }

  async createDirectory(input: Record<string, unknown>): Promise<{ node: { id: number } }> {
    directories.push(input);
    return { node: { id: directories.length } };
  }

  async uploadFile(input: Record<string, unknown>): Promise<{ node: { id: number } }> {
    uploads.push(input);
    return { node: { id: uploads.length } };
  }
}

const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(request: string, ...args: unknown[]) {
  if (request === '@apphub/filestore-client') {
    return {
      FilestoreClient: StubFilestoreClient,
      FilestoreClientError: StubFilestoreClientError
    };
  }
  if (request === '../../shared/scratchGuard' || request.endsWith('/shared/scratchGuard')) {
    return {
      enforceScratchOnlyWrites: () => {}
    };
  }
  return originalRequire.call(this, request, ...args);
};

test('observatory data generator can run repeatedly for the same minute', async (t) => {
  t.after(() => {
    Module.prototype.require = originalRequire;
  });

  const module = await import('./index');
  const handler = module.handler;

  const baseParameters = {
    rowsPerInstrument: 3,
    intervalMinutes: 1,
    instrumentCount: 2,
    seed: 99,
    filestoreBaseUrl: 'http://test-filestore.local',
    filestoreBackendId: 1,
    inboxPrefix: 'datasets/observatory/inbox',
    stagingPrefix: 'datasets/observatory/staging',
    archivePrefix: 'datasets/observatory/archive',
    instrumentProfiles: [
      { instrumentId: 'instrument_alpha', site: 'west-basin' },
      { instrumentId: 'instrument_bravo', site: 'east-ridge' }
    ]
  } as const;

  const createContext = () => {
    const updates: Array<Record<string, unknown>> = [];
    return {
      parameters: { ...baseParameters, minute: '2024-04-01T00:00' },
      logger: () => {},
      update: async (patch: Record<string, unknown>) => {
        updates.push(patch);
      },
      updates
    };
  };

  const first = createContext();
  const firstResult = await handler(first as any);
  assert.equal(firstResult.status, 'succeeded');
  const firstUpdate = first.updates.at(-1) as Record<string, unknown> | undefined;
  assert.ok(firstUpdate, 'first run should emit an update');
  const firstMetrics = firstUpdate?.metrics as Record<string, unknown> | undefined;
  assert.equal(firstMetrics?.filesCreated, baseParameters.instrumentProfiles.length);
  assert.equal(firstMetrics?.instrumentCount, baseParameters.instrumentProfiles.length);

  const second = createContext();
  const secondResult = await handler(second as any);
  assert.equal(secondResult.status, 'succeeded');
  const secondMetrics = (second.updates.at(-1) as Record<string, unknown> | undefined)?.metrics as
    | Record<string, unknown>
    | undefined;
  assert.equal(secondMetrics?.filesCreated, baseParameters.instrumentProfiles.length);

  assert.equal(uploads.length, baseParameters.instrumentProfiles.length * 2);
  assert.equal(directories.length >= baseParameters.instrumentProfiles.length, true);
});
