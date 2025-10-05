/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_37 = {
  jobs: Array<{
    /**
     * Identifier of the reconciliation job.
     */
    id: number;
    /**
     * Deterministic key used for idempotent job scheduling.
     */
    jobKey: string;
    /**
     * Backend mount identifier associated with the job.
     */
    backendMountId: number;
    /**
     * Identifier of the node under reconciliation.
     */
    nodeId: number | null;
    /**
     * Path of the node under reconciliation.
     */
    path: string;
    reason: 'drift' | 'audit' | 'manual';
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
    /**
     * Whether child reconciliation jobs were requested.
     */
    detectChildren: boolean;
    /**
     * Whether a hash recalculation was requested.
     */
    requestedHash: boolean;
    /**
     * Attempt counter for the job.
     */
    attempt: number;
    /**
     * Map of string keys to arbitrary JSON values.
     */
    result: any | null;
    /**
     * Map of string keys to arbitrary JSON values.
     */
    error: any | null;
    /**
     * Timestamp when the job was enqueued.
     */
    enqueuedAt: string;
    /**
     * Timestamp when the job started processing.
     */
    startedAt: string | null;
    /**
     * Timestamp when the job finished processing.
     */
    completedAt: string | null;
    /**
     * Duration in milliseconds, when available.
     */
    durationMs: number | null;
    /**
     * Timestamp when the job record was last updated.
     */
    updatedAt: string;
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
    /**
     * Backend mount filter applied to the query.
     */
    backendMountId: number | null;
    /**
     * Path filter applied to the job listing.
     */
    path: string | null;
    status: Array<'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'>;
  };
};

