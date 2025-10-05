/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_59 = {
  id: string;
  name: string;
  type?: 'job';
  jobSlug: string;
  description?: string | null;
  dependsOn?: Array<string>;
  parameters?: ((string | number | boolean | Record<string, any>) | null);
  timeoutMs?: number | null;
  retryPolicy?: any | null;
  storeResultAs?: string | null;
};

