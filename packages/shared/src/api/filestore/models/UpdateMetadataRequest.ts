/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type UpdateMetadataRequest = {
  /**
   * Backend mount containing the node.
   */
  backendMountId: number;
  /**
   * Metadata entries to overwrite.
   */
  set?: Record<string, def_0> | null;
  /**
   * Metadata keys to remove from the node.
   */
  unset?: Array<string>;
  /**
   * Optional idempotency key.
   */
  idempotencyKey?: string;
};

