import { describe, expect, it } from 'vitest';
import {
  filestoreCommandResponseSchema,
  filestoreEventSchema,
  filestoreNodeSchema,
  filestoreNodeEventPayloadSchema
} from '../types';

const iso = new Date().toISOString();

describe('filestore types', () => {
  it('parses node payloads with rollup summaries', () => {
    const parsed = filestoreNodeSchema.parse({
      id: 42,
      backendMountId: 7,
      parentId: null,
      path: '/data',
      name: 'data',
      depth: 0,
      kind: 'directory',
      sizeBytes: 0,
      checksum: null,
      contentHash: null,
      metadata: { owner: 'analytics' },
      state: 'active',
      version: 3,
      isSymlink: false,
      lastSeenAt: iso,
      lastModifiedAt: null,
      consistencyState: 'active',
      consistencyCheckedAt: iso,
      lastReconciledAt: iso,
      lastDriftDetectedAt: null,
      createdAt: iso,
      updatedAt: iso,
      deletedAt: null,
      rollup: {
        nodeId: 42,
        sizeBytes: 1024,
        fileCount: 5,
        directoryCount: 2,
        childCount: 7,
        state: 'up_to_date',
        lastCalculatedAt: iso
      }
    });

    expect(parsed.rollup).not.toBeNull();
    expect(parsed.rollup?.childCount).toBe(7);
  });

  it('parses node created events', () => {
    const payload = filestoreNodeEventPayloadSchema.parse({
      backendMountId: 7,
      nodeId: 42,
      path: '/data',
      kind: 'directory',
      state: 'active',
      parentId: null,
      version: 1,
      sizeBytes: 0,
      checksum: null,
      contentHash: null,
      metadata: {},
      journalId: 99,
      command: 'createDirectory',
      idempotencyKey: null,
      principal: 'tester',
      observedAt: iso
    });

    const event = filestoreEventSchema.parse({
      type: 'filestore.node.created',
      data: payload
    });

    expect(event.type).toBe('filestore.node.created');
    expect(event.data.journalId).toBe(99);
  });

  it('parses command response envelopes', () => {
    const command = filestoreCommandResponseSchema.parse({
      idempotent: false,
      journalEntryId: 15,
      node: null,
      result: { status: 'queued' }
    });

    expect(command.journalEntryId).toBe(15);
    expect(command.result).toEqual({ status: 'queued' });
  });
});
