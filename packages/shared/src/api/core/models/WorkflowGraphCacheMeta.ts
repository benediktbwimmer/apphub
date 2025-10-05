/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowGraphCacheMeta = {
  hit: boolean;
  cachedAt?: string | null;
  ageMs?: number | null;
  expiresAt?: string | null;
  stats: {
    hits: number;
    misses: number;
    invalidations: number;
  };
  lastInvalidatedAt?: string | null;
  lastInvalidationReason?: string | null;
};

