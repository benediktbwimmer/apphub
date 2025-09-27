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

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

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
            rootPath: '/var/filestore',
            bucket: null,
            prefix: null
          }
        ]
      }
    };

    const fetchMock = vi.fn<FetchLike>(async (input, init) => {
      if (typeof input !== 'string') {
        throw new Error('Expected mount discovery URL to be a string.');
      }
      expect(input).toContain('/v1/backend-mounts');
      expect(init?.method).toBe('GET');
      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const result = await listBackendMounts(fetchMock);
    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0].mountKey).toBe('primary');
    expect(fetchMock).toHaveBeenCalledOnce();
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
        path: 'datasets/catalog',
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

    const fetchMock = vi.fn<FetchLike>(async (input, init) => {
      if (typeof input !== 'string') {
        throw new Error('Expected metadata request URL to be a string.');
      }
      expect(input).toContain('/v1/nodes/42/metadata');
      expect(init?.method).toBe('PATCH');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.backendMountId).toBe(5);
      expect(body.set.owner).toBe('ops');
      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const result = await updateNodeMetadata(fetchMock, {
      nodeId: 42,
      backendMountId: 5,
      set: { owner: 'ops' }
    });

    expect(result.journalEntryId).toBe(77);
    const metadataResult = result.result as { nodeId: number };
    expect(metadataResult.nodeId).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    const fetchMock = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.path).toBe('datasets/raw');
      expect(body.targetPath).toBe('datasets/archive');
      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const result = await moveNode(fetchMock, {
      backendMountId: 9,
      path: 'datasets/raw',
      targetPath: 'datasets/archive'
    });

    expect(result.journalEntryId).toBe(88);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    const fetchMock = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.path).toBe('datasets/archive');
      expect(body.targetPath).toBe('datasets/archive-copy');
      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const result = await copyNode(fetchMock, {
      backendMountId: 9,
      path: 'datasets/archive',
      targetPath: 'datasets/archive-copy'
    });

    expect(result.journalEntryId).toBe(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    const fetchMock = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        'Idempotency-Key': 'upload-1',
        'x-filestore-principal': 'tester',
        'x-filestore-checksum': 'sha256:abc',
        'x-filestore-content-hash': 'sha256:def'
      });

      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('backendMountId')).toBe('3');
      expect(form.get('path')).toBe('datasets/sample.txt');
      expect(form.get('overwrite')).toBe('true');
      expect(form.get('metadata')).toBe(JSON.stringify({ owner: 'ops' }));
      expect(form.get('idempotencyKey')).toBe('upload-1');

      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const blob = new Blob(['hello'], { type: 'text/plain' });
    Object.assign(blob, { name: 'sample.txt' });

    const result = await uploadFile(fetchMock, {
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    const fetchMock = vi.fn<FetchLike>(async (input) => {
      if (typeof input !== 'string') {
        throw new Error('Expected presign URL to be a string.');
      }
      expect(input).toContain('/v1/files/55/presign');
      return {
        ok: true,
        text: async () => JSON.stringify(payload)
      } as Response;
    });

    const result = await presignNodeDownload(fetchMock, 55);
    expect(result.url).toBe('https://presign.example/file');
    expect(result.method).toBe('GET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    const fetchMock = vi.fn<FetchLike>(async (input, init) => {
      expect(typeof input).toBe('string');
      expect((input as string)).toContain('/v1/reconciliation/jobs');
      expect(init?.method).toBe('GET');
      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const result = await listReconciliationJobs(fetchMock, {
      backendMountId: 2,
      statuses: ['running'],
      limit: 20
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe('running');
    expect(fetchMock).toHaveBeenCalledOnce();
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

    const fetchMock = vi.fn<FetchLike>(async (input, init) => {
      expect(typeof input).toBe('string');
      expect((input as string)).toContain('/v1/reconciliation/jobs/7');
      expect(init?.method).toBe('GET');
      return {
        ok: true,
        text: async () => JSON.stringify(responsePayload)
      } as Response;
    });

    const job = await fetchReconciliationJob(fetchMock, 7);
    expect(job.status).toBe('succeeded');
    expect(job.result?.outcome).toBe('reconciled');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
