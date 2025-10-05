/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowStep = ({
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
} | {
  id: string;
  name: string;
  type: 'service';
  serviceSlug: string;
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
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request: {
    path: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    headers?: Record<string, (string | {
      secret: {
        source: 'env' | 'store';
        key: string;
        version?: string;
      };
      prefix?: string;
    })>;
    query?: Record<string, (string | number | boolean)>;
    /**
     * Arbitrary JSON value.
     */
    body?: (string | number | boolean | Record<string, any>) | null;
  };
} | {
  id: string;
  name: string;
  type: 'fanout';
  description?: string | null;
  dependsOn?: Array<string>;
  /**
   * Arbitrary JSON value.
   */
  collection: (string | number | boolean | Record<string, any>) | null;
  template: ({
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
  } | {
    id: string;
    name: string;
    type: 'service';
    serviceSlug: string;
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
    requireHealthy?: boolean;
    allowDegraded?: boolean;
    captureResponse?: boolean;
    storeResponseAs?: string;
    request: {
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
      headers?: Record<string, (string | {
        secret: {
          source: 'env' | 'store';
          key: string;
          version?: string;
        };
        prefix?: string;
      })>;
      query?: Record<string, (string | number | boolean)>;
      /**
       * Arbitrary JSON value.
       */
      body?: (string | number | boolean | Record<string, any>) | null;
    };
  });
  maxItems?: number | null;
  maxConcurrency?: number | null;
  storeResultsAs?: string;
});

