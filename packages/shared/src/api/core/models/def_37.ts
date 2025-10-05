/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_37 = {
  /**
   * Unique identifier for the service.
   */
  slug: string;
  displayName: string;
  /**
   * Service kind or integration type.
   */
  kind: string;
  baseUrl: string;
  status?: 'unknown' | 'healthy' | 'degraded' | 'unreachable';
  statusMessage?: string | null;
  /**
   * Optional capability metadata exposed by the service.
   */
  capabilities?: any | null;
  /**
   * Optional metadata describing manifest provenance, linked apps, and runtime expectations.
   */
  metadata?: any | null;
  /**
   * Source type. External registrations must use "external".
   */
  source?: 'external' | 'module';
};

