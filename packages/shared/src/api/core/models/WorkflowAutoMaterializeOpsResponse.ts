/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_69 } from './def_69';
import type { def_70 } from './def_70';
import type { def_71 } from './def_71';
export type WorkflowAutoMaterializeOpsResponse = {
  data: {
    runs: Array<def_69>;
    inFlight: def_70 | null;
    cooldown: def_71 | null;
    updatedAt: string;
  };
  meta?: {
    workflow?: {
      id: string;
      slug: string;
      name: string;
    };
    limit?: number;
    offset?: number;
  };
};

