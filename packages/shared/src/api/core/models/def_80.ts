/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_80 = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  partitioning: ((string | number | boolean | Record<string, any>) | null);
  autoMaterialize: ((string | number | boolean | Record<string, any>) | null);
  freshness: ((string | number | boolean | Record<string, any>) | null);
};

