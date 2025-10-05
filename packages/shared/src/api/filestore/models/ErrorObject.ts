/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ErrorObject = {
  /**
   * Stable machine-readable identifier for the error.
   */
  code: string;
  /**
   * Human-readable explanation of the error.
   */
  message: string;
  /**
   * Arbitrary JSON value.
   */
  details?: (string | number | boolean | Record<string, any>) | null;
};

