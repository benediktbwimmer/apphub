/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_18 = {
  name?: string;
  description?: string | null;
  searchInput?: string;
  /**
   * Selected status filters applied when executing the saved search.
   */
  statusFilters?: Array<string>;
  /**
   * Preferred sort mode for rendering results.
   */
  sort?: string;
  /**
   * Logical grouping for the saved search (e.g. core, runs).
   */
  category?: string;
  /**
   * Structured configuration used to rehydrate saved filters.
   */
  config?: Record<string, any>;
};

