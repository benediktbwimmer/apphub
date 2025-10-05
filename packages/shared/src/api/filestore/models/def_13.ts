/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_13 = {
  /**
   * Unique slug for the backend mount.
   */
  mountKey: string;
  backendKind: 'local' | 's3';
  /**
   * Optional display name.
   */
  displayName?: string | null;
  /**
   * Optional description.
   */
  description?: string | null;
  /**
   * Point of contact for the backend.
   */
  contact?: string | null;
  /**
   * Optional labels providing additional context.
   */
  labels?: Array<string>;
  /**
   * Override the lifecycle state for the backend.
   */
  state?: 'active' | 'inactive' | 'offline' | 'degraded' | 'error' | 'unknown';
  /**
   * Explanation for the assigned state.
   */
  stateReason?: string | null;
  /**
   * Desired access level for the backend.
   */
  accessMode?: 'rw' | 'ro';
  /**
   * Path to mount for local backends.
   */
  rootPath?: string | null;
  /**
   * Bucket name for S3 backends.
   */
  bucket?: string | null;
  /**
   * Optional path prefix when interacting with the backend.
   */
  prefix?: string | null;
  /**
   * Backend specific configuration overrides.
   */
  config?: any | null;
};

