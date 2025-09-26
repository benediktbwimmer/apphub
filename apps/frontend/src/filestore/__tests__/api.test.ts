import { describe, expect, it } from 'vitest';
import { parseFilestoreEventFrame } from '../api';
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
    expect(event?.type).toBe('filestore.node.created');
    expect(event?.data.backendMountId).toBe(3);
    expect(event?.data.command).toBe('createDirectory');
  });

  it('honours event type filters', () => {
    const frame = [
      'event: filestore.node.deleted',
      `data: {"type":"filestore.node.deleted","data":{"backendMountId":3,"nodeId":5,"path":"/docs","kind":"directory","state":"deleted","parentId":null,"version":2,"sizeBytes":0,"checksum":null,"contentHash":null,"metadata":{},"journalId":18,"command":"deleteNode","idempotencyKey":null,"principal":null,"observedAt":"${iso}"}}`
    ].join('\n');

    const event = parseFilestoreEventFrame(frame, ['filestore.node.created']);
    expect(event).toBeNull();
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
});
