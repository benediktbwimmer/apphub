/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type NodeListFilters = {
  /**
   * Backend filter applied to the query.
   */
  backendMountId: number;
  /**
   * Optional path prefix filter.
   */
  path: string | null;
  /**
   * Maximum depth relative to the provided path.
   */
  depth: number | null;
  states: Array<'active' | 'inconsistent' | 'missing' | 'deleted'>;
  kinds: Array<'file' | 'directory'>;
  /**
   * Term supplied via search or advanced filters.
   */
  search: string | null;
  /**
   * Whether only nodes with detected drift were requested.
   */
  driftOnly: boolean;
  advanced: {
    /**
     * Full-text search term applied to node names and metadata.
     */
    query?: string;
    /**
     * Match nodes whose metadata entries equal the supplied values.
     */
    metadata?: Array<{
      /**
       * Metadata key to match.
       */
      key: string;
      value: def_0;
    }>;
    /**
     * Range constraint applied to numeric values.
     */
    size?: {
      /**
       * Lower bound, inclusive.
       */
      min?: number;
      /**
       * Upper bound, inclusive.
       */
      max?: number;
    };
    /**
     * Range constraint applied to ISO-8601 timestamps.
     */
    lastSeenAt?: {
      /**
       * Lower inclusive bound.
       */
      after?: string;
      /**
       * Upper inclusive bound.
       */
      before?: string;
    };
    /**
     * Advanced rollup constraints applied when filtering nodes.
     */
    rollup?: {
      states?: Array<'up_to_date' | 'pending' | 'stale' | 'invalid'>;
      minChildCount?: number;
      maxChildCount?: number;
      minFileCount?: number;
      maxFileCount?: number;
      minDirectoryCount?: number;
      maxDirectoryCount?: number;
      minSizeBytes?: number;
      maxSizeBytes?: number;
      lastCalculatedAfter?: string;
      lastCalculatedBefore?: string;
    };
  } | null;
};

