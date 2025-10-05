/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type JobRetryPolicy = {
  maxAttempts?: number;
  strategy?: 'none' | 'fixed' | 'exponential';
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: 'none' | 'full' | 'equal';
};

