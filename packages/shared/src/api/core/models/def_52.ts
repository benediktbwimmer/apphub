/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_52 = {
  /**
   * Relative path of the file inside the bundle.
   */
  path: string;
  /**
   * File contents encoded as UTF-8 text or base64.
   */
  contents: string;
  /**
   * Encoding of the contents value. Defaults to utf8 when omitted.
   */
  encoding?: 'utf8' | 'base64';
  /**
   * Whether the file should be marked as executable in the generated bundle.
   */
  executable?: boolean;
};

