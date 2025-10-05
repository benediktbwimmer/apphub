/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_23 = {
  parent: {
    /**
     * Unique identifier for the node.
     */
    id: number;
    /**
     * Identifier of the backend mount containing the node.
     */
    backendMountId: number;
    /**
     * Identifier of the parent directory, if any.
     */
    parentId: number | null;
    /**
     * Normalized absolute path for the node.
     */
    path: string;
    /**
     * Basename of the node.
     */
    name: string;
    /**
     * Directory depth starting from the backend root.
     */
    depth: number;
    kind: 'file' | 'directory';
    /**
     * Logical size recorded for the node, in bytes.
     */
    sizeBytes: number;
    /**
     * Checksum recorded for the node content.
     */
    checksum: string | null;
    /**
     * Content hash recorded for the node content.
     */
    contentHash: string | null;
    /**
     * Arbitrary metadata captured for the node.
     */
    metadata: Record<string, def_0>;
    /**
     * Lifecycle state tracked for the node.
     */
    state: 'active' | 'inconsistent' | 'missing' | 'deleted';
    /**
     * Monotonic version counter for optimistic concurrency.
     */
    version: number;
    /**
     * Indicates if the node represents a symbolic link.
     */
    isSymlink: boolean;
    /**
     * Timestamp when the node was last observed in the backend.
     */
    lastSeenAt: string;
    /**
     * Last modification timestamp reported by the backend.
     */
    lastModifiedAt: string | null;
    /**
     * Consistency status derived from reconciliation.
     */
    consistencyState: 'active' | 'inconsistent' | 'missing';
    /**
     * Timestamp of the most recent consistency check.
     */
    consistencyCheckedAt: string;
    /**
     * Timestamp of the most recent reconciliation success.
     */
    lastReconciledAt: string | null;
    /**
     * Timestamp when drift was last detected.
     */
    lastDriftDetectedAt: string | null;
    /**
     * Timestamp when the node record was created.
     */
    createdAt: string;
    /**
     * Timestamp when the node record was last updated.
     */
    updatedAt: string;
    /**
     * Timestamp when the node was marked deleted.
     */
    deletedAt: string | null;
    rollup: any | null;
    download: any | null;
  };
  children: Array<{
    /**
     * Unique identifier for the node.
     */
    id: number;
    /**
     * Identifier of the backend mount containing the node.
     */
    backendMountId: number;
    /**
     * Identifier of the parent directory, if any.
     */
    parentId: number | null;
    /**
     * Normalized absolute path for the node.
     */
    path: string;
    /**
     * Basename of the node.
     */
    name: string;
    /**
     * Directory depth starting from the backend root.
     */
    depth: number;
    kind: 'file' | 'directory';
    /**
     * Logical size recorded for the node, in bytes.
     */
    sizeBytes: number;
    /**
     * Checksum recorded for the node content.
     */
    checksum: string | null;
    /**
     * Content hash recorded for the node content.
     */
    contentHash: string | null;
    /**
     * Arbitrary metadata captured for the node.
     */
    metadata: Record<string, def_0>;
    /**
     * Lifecycle state tracked for the node.
     */
    state: 'active' | 'inconsistent' | 'missing' | 'deleted';
    /**
     * Monotonic version counter for optimistic concurrency.
     */
    version: number;
    /**
     * Indicates if the node represents a symbolic link.
     */
    isSymlink: boolean;
    /**
     * Timestamp when the node was last observed in the backend.
     */
    lastSeenAt: string;
    /**
     * Last modification timestamp reported by the backend.
     */
    lastModifiedAt: string | null;
    /**
     * Consistency status derived from reconciliation.
     */
    consistencyState: 'active' | 'inconsistent' | 'missing';
    /**
     * Timestamp of the most recent consistency check.
     */
    consistencyCheckedAt: string;
    /**
     * Timestamp of the most recent reconciliation success.
     */
    lastReconciledAt: string | null;
    /**
     * Timestamp when drift was last detected.
     */
    lastDriftDetectedAt: string | null;
    /**
     * Timestamp when the node record was created.
     */
    createdAt: string;
    /**
     * Timestamp when the node record was last updated.
     */
    updatedAt: string;
    /**
     * Timestamp when the node was marked deleted.
     */
    deletedAt: string | null;
    rollup: any | null;
    download: any | null;
  }>;
  pagination: {
    /**
     * Total matching records.
     */
    total: number;
    /**
     * Requested page size.
     */
    limit: number;
    /**
     * Current offset within the collection.
     */
    offset: number;
    /**
     * Next offset to request, if more data is available.
     */
    nextOffset: number | null;
  };
  filters: {
    states: Array<'active' | 'inconsistent' | 'missing' | 'deleted'>;
    kinds: Array<'file' | 'directory'>;
    search: string | null;
    driftOnly: boolean;
    advanced: any | null;
  };
};

