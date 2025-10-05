/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_33 = {
  /**
   * Backend mount containing the node to reconcile.
   */
  backendMountId: number;
  /**
   * Path of the node to reconcile.
   */
  path: string;
  /**
   * Identifier of the node to reconcile.
   */
  nodeId?: number | null;
  /**
   * Reason the reconciliation was requested.
   */
  reason?: 'drift' | 'audit' | 'manual';
  /**
   * When true, enqueue reconciliation jobs for child nodes.
   */
  detectChildren?: boolean;
  /**
   * When true, force hash recomputation for the node.
   */
  requestedHash?: boolean;
};

