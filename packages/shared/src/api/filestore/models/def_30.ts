/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_30 = {
  /**
   * Backend mount containing the source node.
   */
  backendMountId: number;
  /**
   * Source node path.
   */
  path: string;
  /**
   * Destination path for the node.
   */
  targetPath: string;
  /**
   * Alternate backend mount for cross-mount moves.
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

