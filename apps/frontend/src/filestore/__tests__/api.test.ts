import { describe, expect, it, vi } from 'vitest';
import {
  copyNode,
  fetchReconciliationJob,
  listBackendMounts,
  listReconciliationJobs,
  moveNode,
  parseFilestoreEventFrame,
  presignNodeDownload,
  updateNodeMetadata,
  uploadFile
} from '../api';
import { describeFilestoreEvent } from '../eventSummaries';
import type { FilestoreEvent } from '../api';

const iso = new Date().toISOString();

describe('filestore api helpers', () => {
  it('parses SSE frames into typed events', () => {
    const frame = [
      'event: filestore.node.created',
      `data: {"type":"filestore.node.created","data":{"backendMountId":3,"nodeId":5,"path":"/docs","kind":"directory","state":"active","parentId":null,"version":1,"sizeBytes":0,"checksum":null,"contentHash":null,"metadata":{},"journalId":17,"command":"createDirectory","idempotencyKey":null,"principal":"tester","observedAt":"${iso}"}}`
    ].join('\n');

    const event = parseFilestoreEventFrame(frame);
    expect(event).not.toBeNull();
    if (!event) {
      throw new Error('Expected filestore event.');
    }
    expect(event.type).toBe('filestore.node.created');
    if (event.type !== 'filestore.node.created') {
      throw new Error('Unexpected event type.');
    }
    expect(event.data.backendMountId).toBe(3);
    expect(event.data.command).toBe('createDirectory');
  });

  it('honours event type filters', () => {
    const frame = [
      'event: filestore.node.deleted',
      `data: {"type":"filestore.node.deleted","data":{"backendMountId":3,"nodeId":5,"path":"/docs","kind":"directory","state":"deleted","parentId":null,"version":2,"sizeBytes":0,"checksum":null,"contentHash":null,"metadata":{},"journalId":18,"command":"deleteNode","idempotencyKey":null,"principal":null,"observedAt":"${iso}"}}`
    ].join('\n');

    const event = parseFilestoreEventFrame(frame, ['filestore.node.created']);
    expect(event).toBeNull();
  });

  it('lists backend mounts via GET request', async () => {
    const responsePayload = {
      data: {
        mounts: [
          {
            id: 5,
            mountKey: 'primary',
            backendKind: 'local',
            accessMode: 'rw',
            state: 'active',
            displayName: 'Primary mount',
            description: 'Primary data root',
            contact: 'ops@apphub.dev',
            labels: ['primary'],
            stateReason: null,
            rootPath: '/var/filestore',
            bucket: null,
            prefix: null,
            lastHealthCheckAt: null,
            lastHealthStatus: null,
            createdAt: iso,
            updatedAt: iso
          }
        ],
        pagination: {
          total: 1,
          limit: 25,
          offset: 0,
          nextOffset: null
        },
        filters: {
          search: null,
          kinds: [],
          states: [],
          accessModes: []
        }
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      if (typeof input !== 'string') {
        throw new Error('Expected mount discovery URL to be a string.');
      }
      expect(input).toContain('/v1/backend-mounts');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await listBackendMounts('test-token');
    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0].mountKey).toBe('primary');
    expect(result.pagination.total).toBe(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it('summarizes node created events for the activity feed', () => {
    const event: FilestoreEvent = {
      type: 'filestore.node.created',
      data: {
        backendMountId: 4,
        nodeId: 99,
        path: 'datasets/observatory',
        kind: 'directory',
        state: 'active',
        parentId: null,
        version: 1,
        sizeBytes: 0,
        checksum: null,
        contentHash: null,
        metadata: {},
        journalId: 12,
        command: 'createDirectory',
        idempotencyKey: null,
        principal: 'tester',
        observedAt: iso
      }
    };

    const entry = describeFilestoreEvent(event);
    expect(entry.label).toBe('Node created');
    expect(entry.detail).toContain('datasets/observatory');
    expect(entry.backendMountId).toBe(4);
  });

  it('summarizes drift detected events for the activity feed', () => {
    const event: FilestoreEvent = {
      type: 'filestore.drift.detected',
      data: {
        backendMountId: 2,
        nodeId: 17,
        path: 'datasets/core',
        detectedAt: iso,
        reason: 'hash_mismatch',
        reporter: 'watcher',
        metadata: {}
      }
    };

    const entry = describeFilestoreEvent(event);
    expect(entry.label).toBe('Drift detected');
    expect(entry.detail).toContain('hash_mismatch');
    expect(entry.timestamp).toBe(iso);
  });

  it('summarizes download events for the activity feed', () => {
    const event: FilestoreEvent = {
      type: 'filestore.node.downloaded',
      data: {
        backendMountId: 7,
        nodeId: 91,
        path: 'datasets/archive/report.csv',
        sizeBytes: 1024,
        checksum: null,
        contentHash: null,
        principal: 'tester',
        mode: 'stream',
        range: null,
        observedAt: iso
      }
    };

    const entry = describeFilestoreEvent(event);
    expect(entry.label).toBe('Download');
    expect(entry.detail).toContain('datasets/archive/report.csv');
    expect(entry.backendMountId).toBe(7);
  });

  it('sends metadata updates via PATCH request', async () => {
    const responsePayload = {
      data: {
        idempotent: false,
        journalEntryId: 77,
        node: null,
        result: { nodeId: 42 }
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      if (typeof input !== 'string') {
        throw new Error('Expected metadata request URL to be a string.');
      }
      expect(input).toContain('/v1/nodes/42/metadata');
      expect(init?.method).toBe('PATCH');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.backendMountId).toBe(5);
      expect(body.set.owner).toBe('ops');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      expect(headers.get('Idempotency-Key')).toBeNull();
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await updateNodeMetadata('test-token', {
      nodeId: 42,
      backendMountId: 5,
      set: { owner: 'ops' }
    });

    expect(result.journalEntryId).toBe(77);
    const metadataResult = result.result as { nodeId: number };
    expect(metadataResult.nodeId).toBe(42);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('moves nodes via POST request', async () => {
    const responsePayload = {
      data: {
        idempotent: false,
        journalEntryId: 88,
        node: null,
        result: { path: 'datasets/archive' }
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('POST');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.path).toBe('datasets/raw');
      expect(body.targetPath).toBe('datasets/archive');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer move-token');
      expect(headers.get('Idempotency-Key')).toBeNull();
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await moveNode('move-token', {
      backendMountId: 9,
      path: 'datasets/raw',
      targetPath: 'datasets/archive'
    });

    expect(result.journalEntryId).toBe(88);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('copies nodes via POST request', async () => {
    const responsePayload = {
      data: {
        idempotent: false,
        journalEntryId: 99,
        node: null,
        result: { path: 'datasets/archive-copy' }
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('POST');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.path).toBe('datasets/archive');
      expect(body.targetPath).toBe('datasets/archive-copy');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer copy-token');
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await copyNode('copy-token', {
      backendMountId: 9,
      path: 'datasets/archive',
      targetPath: 'datasets/archive-copy'
    });

    expect(result.journalEntryId).toBe(99);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('uploads files via multipart request', async () => {
    const responsePayload = {
      data: {
        idempotent: false,
        journalEntryId: 123,
        node: null,
        result: { path: 'datasets/sample.txt' }
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer upload-token');
      expect(headers.get('Idempotency-Key')).toBe('upload-1');
      expect(headers.get('x-filestore-principal')).toBe('tester');
      expect(headers.get('x-filestore-checksum')).toBe('sha256:abc');
      expect(headers.get('x-filestore-content-hash')).toBe('sha256:def');

      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('backendMountId')).toBe('3');
      expect(form.get('path')).toBe('datasets/sample.txt');
      expect(form.get('overwrite')).toBe('true');
      expect(form.get('metadata')).toBe(JSON.stringify({ owner: 'ops' }));
      expect(form.get('idempotencyKey')).toBe('upload-1');

      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const blob = new Blob(['hello'], { type: 'text/plain' });
    Object.assign(blob, { name: 'sample.txt' });

    const result = await uploadFile('upload-token', {
      backendMountId: 3,
      path: 'datasets/sample.txt',
      file: blob,
      overwrite: true,
      metadata: { owner: 'ops' },
      idempotencyKey: 'upload-1',
      checksum: 'sha256:abc',
      contentHash: 'sha256:def',
      principal: 'tester'
    });

    expect(result.journalEntryId).toBe(123);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('requests presigned download metadata', async () => {
    const payload = {
      data: {
        url: 'https://presign.example/file',
        expiresAt: iso,
        headers: { Authorization: 'AWS4-HMAC' },
        method: 'GET'
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      if (typeof input !== 'string') {
        throw new Error('Expected presign URL to be a string.');
      }
      expect(input).toContain('/v1/files/55/presign');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer presign-token');
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await presignNodeDownload('presign-token', 55);
    expect(result.url).toBe('https://presign.example/file');
    expect(result.method).toBe('GET');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('lists reconciliation jobs via GET request', async () => {
    const responsePayload = {
      data: {
        jobs: [
          {
            id: 1,
            jobKey: 'reconcile:2:datasets/example',
            backendMountId: 2,
            nodeId: 42,
            path: 'datasets/example',
            reason: 'manual',
            status: 'running',
            detectChildren: false,
            requestedHash: false,
            attempt: 1,
            result: null,
            error: null,
            enqueuedAt: iso,
            startedAt: iso,
            completedAt: null,
            durationMs: null,
            updatedAt: iso
          }
        ],
        pagination: { total: 1, limit: 20, offset: 0, nextOffset: null },
        filters: { backendMountId: 2, path: null, status: [] }
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      expect(typeof input).toBe('string');
      expect((input as string)).toContain('/v1/reconciliation/jobs');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer reconcile-token');
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await listReconciliationJobs('reconcile-token', {
      backendMountId: 2,
      statuses: ['running'],
      limit: 20
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe('running');
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it('fetches reconciliation job detail', async () => {
    const responsePayload = {
      data: {
        id: 7,
        jobKey: 'reconcile:2:datasets/example',
        backendMountId: 2,
        nodeId: 42,
        path: 'datasets/example',
        reason: 'manual',
        status: 'succeeded',
        detectChildren: false,
        requestedHash: false,
        attempt: 1,
        result: { outcome: 'reconciled' },
        error: null,
        enqueuedAt: iso,
        startedAt: iso,
        completedAt: iso,
        durationMs: 4200,
        updatedAt: iso
      }
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      expect(typeof input).toBe('string');
      expect((input as string)).toContain('/v1/reconciliation/jobs/7');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer detail-token');
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const job = await fetchReconciliationJob('detail-token', 7);
    expect(job.status).toBe('succeeded');
    expect(job.result?.outcome).toBe('reconciled');
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});
