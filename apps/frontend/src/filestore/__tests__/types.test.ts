import { describe, expect, it } from 'vitest';
import {
  filestoreCommandResponseSchema,
  filestoreEventSchema,
  filestoreNodeChildrenEnvelopeSchema,
  filestoreNodeListEnvelopeSchema,
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

  it('parses node list envelopes with pagination', () => {
    const parsed = filestoreNodeListEnvelopeSchema.parse({
      data: {
        nodes: [
          {
            id: 1,
            backendMountId: 3,
            parentId: null,
            path: 'datasets',
            name: 'datasets',
            depth: 1,
            kind: 'directory',
            sizeBytes: 0,
            checksum: null,
            contentHash: null,
            metadata: {},
            state: 'active',
            version: 1,
            isSymlink: false,
            lastSeenAt: iso,
            lastModifiedAt: iso,
            consistencyState: 'active',
            consistencyCheckedAt: iso,
            lastReconciledAt: iso,
            lastDriftDetectedAt: null,
            createdAt: iso,
            updatedAt: iso,
            deletedAt: null,
            rollup: {
              nodeId: 1,
              sizeBytes: 0,
              fileCount: 0,
              directoryCount: 1,
              childCount: 2,
              state: 'up_to_date',
              lastCalculatedAt: iso
            }
          }
        ],
        pagination: {
          total: 5,
          limit: 25,
          offset: 0,
          nextOffset: 25
        },
        filters: {
          backendMountId: 3,
          path: null,
          depth: null,
          states: [],
          kinds: [],
          search: null,
          driftOnly: false
        }
      }
    });

    expect(parsed.data.pagination.total).toBe(5);
    expect(parsed.data.filters.backendMountId).toBe(3);
  });

  it('parses node children envelopes', () => {
    const parsed = filestoreNodeChildrenEnvelopeSchema.parse({
      data: {
        parent: {
          id: 2,
          backendMountId: 3,
          parentId: 1,
          path: 'datasets/observatory',
          name: 'observatory',
          depth: 2,
          kind: 'directory',
          sizeBytes: 0,
          checksum: null,
          contentHash: null,
          metadata: {},
          state: 'active',
          version: 1,
          isSymlink: false,
          lastSeenAt: iso,
          lastModifiedAt: iso,
          consistencyState: 'active',
          consistencyCheckedAt: iso,
          lastReconciledAt: iso,
          lastDriftDetectedAt: null,
          createdAt: iso,
          updatedAt: iso,
          deletedAt: null,
          rollup: {
            nodeId: 2,
            sizeBytes: 1024,
            fileCount: 5,
            directoryCount: 2,
            childCount: 7,
            state: 'up_to_date',
            lastCalculatedAt: iso
          }
        },
        children: [
          {
            id: 3,
            backendMountId: 3,
            parentId: 2,
            path: 'datasets/observatory/raw',
            name: 'raw',
            depth: 3,
            kind: 'directory',
            sizeBytes: 0,
            checksum: null,
            contentHash: null,
            metadata: {},
            state: 'active',
            version: 1,
            isSymlink: false,
            lastSeenAt: iso,
            lastModifiedAt: iso,
            consistencyState: 'active',
            consistencyCheckedAt: iso,
            lastReconciledAt: iso,
            lastDriftDetectedAt: null,
            createdAt: iso,
            updatedAt: iso,
            deletedAt: null,
            rollup: {
              nodeId: 3,
              sizeBytes: 256,
              fileCount: 3,
              directoryCount: 1,
              childCount: 3,
              state: 'up_to_date',
              lastCalculatedAt: iso
            }
          }
        ],
        pagination: {
          total: 1,
          limit: 50,
          offset: 0,
          nextOffset: null
        },
        filters: {
          states: [],
          kinds: [],
          search: null,
          driftOnly: false
        }
      }
    });

    expect(parsed.data.parent.path).toBe('datasets/observatory');
    expect(parsed.data.children[0].path).toBe('datasets/observatory/raw');
  });
});
