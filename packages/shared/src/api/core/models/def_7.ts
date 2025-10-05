/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_7 = {
  id: string;
  status: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  buildId: string | null;
  repositoryId: string;
  instanceUrl?: string | null;
  resourceProfile?: string | null;
  /**
   * Environment variables used when starting the launch.
   */
  env?: Array<{
    /**
     * Environment variable name.
     */
    key: string;
    /**
     * Environment variable value.
     */
    value: string;
  }>;
  command?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  stoppedAt?: string | null;
  expiresAt?: string | null;
  port?: number | null;
  internalPort?: number | null;
  containerIp?: string | null;
};

