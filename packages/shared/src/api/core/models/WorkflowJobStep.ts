/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowJobStep = {
  id: string;
  name: string;
  type?: 'job';
  jobSlug: string;
  description?: string | null;
  dependsOn?: Array<string>;
  /**
   * Arbitrary JSON value.
   */
  parameters?: (string | number | boolean | Record<string, any>) | null;
  timeoutMs?: number | null;
  retryPolicy?: {
    maxAttempts?: number;
    strategy?: 'none' | 'fixed' | 'exponential';
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: 'none' | 'full' | 'equal';
  } | null;
  storeResultAs?: string | null;
};

