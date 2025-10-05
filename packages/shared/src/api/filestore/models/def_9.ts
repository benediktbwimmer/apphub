/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_9 = {
  data: {
    /**
     * Unique identifier for the backend mount.
     */
    id: number;
    /**
     * Stable slug identifying the backend.
     */
    mountKey: string;
    /**
     * Human friendly backend name.
     */
    displayName: string | null;
    /**
     * Optional description of the backend.
     */
    description: string | null;
    /**
     * Point of contact for the backend.
     */
    contact: string | null;
    /**
     * Arbitrary labels associated with the backend.
     */
    labels: Array<string>;
    /**
     * Implementation backing this mount.
     */
    backendKind: 'local' | 's3';
    /**
     * Indicates whether files can be written or only read.
     */
    accessMode: 'rw' | 'ro';
    /**
     * Current health state as reported by the mount.
     */
    state: 'active' | 'inactive' | 'offline' | 'degraded' | 'error' | 'unknown';
    /**
     * Additional context explaining the current state.
     */
    stateReason: string | null;
    /**
     * Base path for local backends.
     */
    rootPath: string | null;
    /**
     * Bucket name for S3 backends.
     */
    bucket: string | null;
    /**
     * Optional prefix used when addressing the backend.
     */
    prefix: string | null;
    /**
     * Backend specific configuration. Secrets are omitted.
     */
    config?: any | null;
    /**
     * Timestamp of the most recent health check.
     */
    lastHealthCheckAt: string | null;
    /**
     * Latest reported status message from the backend.
     */
    lastHealthStatus: string | null;
    /**
     * Timestamp when the backend was created.
     */
    createdAt: string;
    /**
     * Timestamp when the backend was last updated.
     */
    updatedAt: string;
  };
};

