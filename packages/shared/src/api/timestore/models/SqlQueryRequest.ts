/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SqlQueryRequest = {
  /**
   * SQL statement to execute.
   */
  sql: string;
  /**
   * Positional parameters bound to the statement.
   */
  params?: Array<(string | number | boolean | Record<string, any>) | null>;
};

