/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type RuntimeReadiness = {
  runtime: 'node' | 'python' | 'docker';
  ready: boolean;
  reason: string | null;
  checkedAt: string;
  details: def_0;
};

