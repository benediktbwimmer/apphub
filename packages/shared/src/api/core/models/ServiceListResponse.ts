/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_31 } from './def_31';
import type { def_32 } from './def_32';
export type ServiceListResponse = {
  data: Array<{
    id: string;
    slug: string;
    displayName: string;
    kind: string;
    baseUrl: string;
    source: 'external' | 'module';
    status: 'unknown' | 'healthy' | 'degraded' | 'unreachable';
    statusMessage?: string | null;
    /**
     * Arbitrary JSON value.
     */
    capabilities?: (string | number | boolean | Record<string, any>) | null;
    /**
     * Structured metadata describing how a service is sourced, linked, and executed.
     */
    metadata?: {
      /**
       * Discriminator indicating this metadata payload represents a service resource.
       */
      resourceType?: 'service';
      manifest?: def_31 | null;
      /**
       * Raw metadata block forwarded from manifests or config files.
       */
      config?: (string | number | boolean | Record<string, any>) | null | null;
      runtime?: def_32 | null;
      /**
       * Explicit list of app IDs linked to this service beyond manifest hints.
       */
      linkedApps?: Array<string> | null;
      notes?: string | null;
    } | null;
    /**
     * Arbitrary JSON value.
     */
    openapi?: (string | number | boolean | Record<string, any>) | null;
    lastHealthyAt?: string | null;
    createdAt: string;
    updatedAt: string;
    health?: {
      status?: 'unknown' | 'healthy' | 'degraded' | 'unreachable';
      statusMessage?: string | null;
      checkedAt?: string | null;
      latencyMs?: number | null;
      statusCode?: number | null;
      baseUrl?: string | null;
      healthEndpoint?: string | null;
    } | null;
  }>;
  meta: {
    total: number;
    healthyCount: number;
    unhealthyCount: number;
    filters?: {
      source?: 'module' | 'external';
    } | null;
    sourceCounts: {
      module: number;
      external: number;
    };
  };
};

