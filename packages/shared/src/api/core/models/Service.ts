/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type Service = {
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
  metadata?: Record<string, any> | null;
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
};

