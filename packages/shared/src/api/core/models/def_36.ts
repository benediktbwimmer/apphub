/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_36 = {
  data: {
    id: string;
    slug: string;
    displayName: string;
    kind: string;
    baseUrl: string;
    source: 'external' | 'module';
    status: 'unknown' | 'healthy' | 'degraded' | 'unreachable';
    statusMessage?: string | null;
    capabilities?: ((string | number | boolean | Record<string, any>) | null);
    /**
     * Structured metadata describing how a service is sourced, linked, and executed.
     */
    metadata?: any | null;
    openapi?: ((string | number | boolean | Record<string, any>) | null);
    lastHealthyAt?: string | null;
    createdAt: string;
    updatedAt: string;
    health?: any | null;
  };
};

