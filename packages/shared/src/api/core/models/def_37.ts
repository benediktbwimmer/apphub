/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_33 } from './def_33';
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
  capabilities?: ((string | number | boolean | Record<string, any>) | null);
  metadata?: (def_33 | null);
  /**
   * Source type. External registrations must use "external".
   */
  source?: 'external';
};

