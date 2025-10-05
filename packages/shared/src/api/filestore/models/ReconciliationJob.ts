/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type ReconciliationJob = {
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
  result: Record<string, def_0> | null;
  /**
   * Map of string keys to arbitrary JSON values.
   */
  error: Record<string, def_0> | null;
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
};

