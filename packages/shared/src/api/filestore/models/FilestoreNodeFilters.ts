/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type FilestoreNodeFilters = {
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
};

