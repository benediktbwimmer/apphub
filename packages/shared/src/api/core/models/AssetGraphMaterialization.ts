/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssetGraphMaterialization = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  runId: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  runStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  stepStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  producedAt: string;
  partitionKey: string | null;
  /**
   * Arbitrary JSON value.
   */
  freshness: (string | number | boolean | Record<string, any>) | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
};

