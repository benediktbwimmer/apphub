/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_20 = {
  /**
   * Backend filter applied to the query.
   */
  backendMountId: number;
  /**
   * Optional path prefix filter.
   */
  path: string | null;
  /**
   * Maximum depth relative to the provided path.
   */
  depth: number | null;
  states: Array<'active' | 'inconsistent' | 'missing' | 'deleted'>;
  kinds: Array<'file' | 'directory'>;
  /**
   * Term supplied via search or advanced filters.
   */
  search: string | null;
  /**
   * Whether only nodes with detected drift were requested.
   */
  driftOnly: boolean;
  advanced: any | null;
};

