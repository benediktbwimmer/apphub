/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BackendMountListFilters = {
  /**
   * Search term applied to mount names or descriptions.
   */
  search: string | null;
  kinds: Array<'local' | 's3'>;
  states: Array<'active' | 'inactive' | 'offline' | 'degraded' | 'error' | 'unknown'>;
  accessModes: Array<'rw' | 'ro'>;
};

