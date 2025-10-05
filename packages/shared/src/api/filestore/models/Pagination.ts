/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type Pagination = {
  /**
   * Total matching records.
   */
  total: number;
  /**
   * Requested page size.
   */
  limit: number;
  /**
   * Current offset within the collection.
   */
  offset: number;
  /**
   * Next offset to request, if more data is available.
   */
  nextOffset: number | null;
};

