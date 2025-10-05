/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_56 = {
  entryPoint: string;
  manifestPath: string;
  manifest?: def_0;
  files: Array<{
    path: string;
    contents: string;
    encoding?: 'utf8' | 'base64';
    executable?: boolean;
  }>;
  capabilityFlags?: Array<string>;
  metadata?: def_0;
  description?: string | null;
  displayName?: string | null;
  version?: string;
};

