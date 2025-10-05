/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type CommandOutcomeEnvelope = {
  data: {
    /**
     * Indicates whether an idempotency key short-circuited the command.
     */
    idempotent: boolean;
    /**
     * Identifier of the journal entry generated for this command.
     */
    journalEntryId: number;
    node: {
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
    } | null;
    /**
     * Command-specific payload describing the work performed.
     */
    result: Record<string, def_0>;
  };
};

