/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_42 = {
  slug: string;
  name: string;
  version?: number;
  type: 'batch' | 'service-triggered' | 'manual';
  runtime?: 'node' | 'python' | 'docker' | 'module';
  entryPoint: string;
  timeoutMs?: number;
  retryPolicy?: {
    maxAttempts?: number;
    strategy?: 'none' | 'fixed' | 'exponential';
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: 'none' | 'full' | 'equal';
  };
  parametersSchema?: any | null;
  defaultParameters?: any | null;
  outputSchema?: any | null;
  metadata?: ((string | number | boolean | Record<string, any>) | null);
};

