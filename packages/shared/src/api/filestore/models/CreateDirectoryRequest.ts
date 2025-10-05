/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type CreateDirectoryRequest = {
  /**
   * Backend mount receiving the directory.
   */
  backendMountId: number;
  /**
   * Directory path to create.
   */
  path: string;
  /**
   * Optional metadata assigned to the directory.
   */
  metadata?: Record<string, def_0>;
  /**
   * Optional idempotency key to reuse previous results.
   */
  idempotencyKey?: string;
};

