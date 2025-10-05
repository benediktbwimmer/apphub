/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type Build = {
  /**
   * Unique build identifier.
   */
  id: string;
  /**
   * Identifier of the source repository.
   */
  repositoryId: string;
  /**
   * Current build status.
   */
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  imageTag: string | null;
  errorMessage?: string | null;
  commitSha?: string | null;
  gitBranch?: string | null;
  gitRef?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  logsPreview?: string | null;
  logsTruncated?: boolean;
  hasLogs?: boolean;
  /**
   * Size of the captured logs in bytes.
   */
  logsSize?: number;
};

