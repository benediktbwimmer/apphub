/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type JobDefinitionCreateRequest = {
  slug: string;
  name: string;
  version?: number;
  type: 'batch' | 'service-triggered' | 'manual';
  runtime?: 'node' | 'python' | 'docker';
  entryPoint: string;
  timeoutMs?: number;
  retryPolicy?: {
    maxAttempts?: number;
    strategy?: 'none' | 'fixed' | 'exponential';
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: 'none' | 'full' | 'equal';
  };
  parametersSchema?: Record<string, any> | null;
  defaultParameters?: Record<string, any> | null;
  outputSchema?: Record<string, any> | null;
  /**
   * Arbitrary JSON value.
   */
  metadata?: (string | number | boolean | Record<string, any>) | null;
};

