/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type NodeChildrenEnvelope = {
  data: {
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
      rollup: {
        /**
         * Identifier of the node associated with this rollup.
         */
        nodeId: number;
        /**
         * Total bytes attributed to the subtree.
         */
        sizeBytes: number;
        /**
         * Number of files in the subtree.
         */
        fileCount: number;
        /**
         * Number of directories in the subtree.
         */
        directoryCount: number;
        /**
         * Total direct children tracked in the rollup.
         */
        childCount: number;
        /**
         * Freshness indicator for the rollup snapshot.
         */
        state: 'up_to_date' | 'pending' | 'stale' | 'invalid';
        /**
         * Timestamp of the most recent rollup calculation.
         */
        lastCalculatedAt: string | null;
      } | null;
      download: {
        /**
         * Preferred download strategy for the file.
         */
        mode: 'stream' | 'presign';
        /**
         * URL to stream the file through the filestore service.
         */
        streamUrl: string;
        /**
         * Link to request a presigned download if supported.
         */
        presignUrl: string | null;
        /**
         * Indicates whether byte-range requests are supported.
         */
        supportsRange: boolean;
        /**
         * Known size of the file when available.
         */
        sizeBytes: number | null;
        /**
         * Checksum recorded for the file content.
         */
        checksum: string | null;
        /**
         * Content hash recorded for the file content.
         */
        contentHash: string | null;
        /**
         * Suggested filename for downloads.
         */
        filename: string | null;
      } | null;
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
      rollup: {
        /**
         * Identifier of the node associated with this rollup.
         */
        nodeId: number;
        /**
         * Total bytes attributed to the subtree.
         */
        sizeBytes: number;
        /**
         * Number of files in the subtree.
         */
        fileCount: number;
        /**
         * Number of directories in the subtree.
         */
        directoryCount: number;
        /**
         * Total direct children tracked in the rollup.
         */
        childCount: number;
        /**
         * Freshness indicator for the rollup snapshot.
         */
        state: 'up_to_date' | 'pending' | 'stale' | 'invalid';
        /**
         * Timestamp of the most recent rollup calculation.
         */
        lastCalculatedAt: string | null;
      } | null;
      download: {
        /**
         * Preferred download strategy for the file.
         */
        mode: 'stream' | 'presign';
        /**
         * URL to stream the file through the filestore service.
         */
        streamUrl: string;
        /**
         * Link to request a presigned download if supported.
         */
        presignUrl: string | null;
        /**
         * Indicates whether byte-range requests are supported.
         */
        supportsRange: boolean;
        /**
         * Known size of the file when available.
         */
        sizeBytes: number | null;
        /**
         * Checksum recorded for the file content.
         */
        checksum: string | null;
        /**
         * Content hash recorded for the file content.
         */
        contentHash: string | null;
        /**
         * Suggested filename for downloads.
         */
        filename: string | null;
      } | null;
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
      advanced: {
        /**
         * Full-text search term applied to node names and metadata.
         */
        query?: string;
        /**
         * Match nodes whose metadata entries equal the supplied values.
         */
        metadata?: Array<{
          /**
           * Metadata key to match.
           */
          key: string;
          value: def_0;
        }>;
        /**
         * Range constraint applied to numeric values.
         */
        size?: {
          /**
           * Lower bound, inclusive.
           */
          min?: number;
          /**
           * Upper bound, inclusive.
           */
          max?: number;
        };
        /**
         * Range constraint applied to ISO-8601 timestamps.
         */
        lastSeenAt?: {
          /**
           * Lower inclusive bound.
           */
          after?: string;
          /**
           * Upper inclusive bound.
           */
          before?: string;
        };
        /**
         * Advanced rollup constraints applied when filtering nodes.
         */
        rollup?: {
          states?: Array<'up_to_date' | 'pending' | 'stale' | 'invalid'>;
          minChildCount?: number;
          maxChildCount?: number;
          minFileCount?: number;
          maxFileCount?: number;
          minDirectoryCount?: number;
          maxDirectoryCount?: number;
          minSizeBytes?: number;
          maxSizeBytes?: number;
          lastCalculatedAfter?: string;
          lastCalculatedBefore?: string;
        };
      } | null;
    };
  };
};

