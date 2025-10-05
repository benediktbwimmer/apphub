/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_31 = {
  /**
   * Backend mount containing the source node.
   */
  backendMountId: number;
  /**
   * Source node path.
   */
  path: string;
  /**
   * Destination path for the copy.
   */
  targetPath: string;
  /**
   * Alternate backend mount for cross-mount copies.
   */
  targetBackendMountId?: number;
  /**
   * When true, replace an existing node at the destination.
   */
  overwrite?: boolean;
  /**
   * Optional idempotency key.
   */
  idempotencyKey?: string;
};

