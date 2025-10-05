/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_36 = {
  /**
   * Backend mount filter applied to the query.
   */
  backendMountId: number | null;
  /**
   * Path filter applied to the job listing.
   */
  path: string | null;
  status: Array<'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'>;
};

