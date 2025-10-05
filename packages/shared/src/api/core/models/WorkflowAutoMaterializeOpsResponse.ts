/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_67 } from './def_67';
import type { def_68 } from './def_68';
import type { def_69 } from './def_69';
export type WorkflowAutoMaterializeOpsResponse = {
  data: {
    runs: Array<def_67>;
    inFlight: def_68 | null;
    cooldown: def_69 | null;
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

