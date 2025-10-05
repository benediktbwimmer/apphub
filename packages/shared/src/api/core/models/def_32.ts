/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Runtime details gathered from the containerized app connected to the service.
 */
export type def_32 = {
  /**
   * Repository ID providing the runtime implementation.
   */
  repositoryId?: string;
  launchId?: string | null;
  instanceUrl?: string | null;
  baseUrl?: string | null;
  previewUrl?: string | null;
  host?: string | null;
  port?: number | null;
  containerIp?: string | null;
  containerPort?: number | null;
  containerBaseUrl?: string | null;
  /**
   * Origin of the runtime snapshot (for example, service-network synchronizer).
   */
  source?: string | null;
  status?: 'running' | 'stopped';
  updatedAt?: string | null;
};

