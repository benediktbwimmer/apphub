/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssetGraphProducer = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  /**
   * Arbitrary JSON value.
   */
  partitioning: (string | number | boolean | Record<string, any>) | null;
  /**
   * Arbitrary JSON value.
   */
  autoMaterialize: (string | number | boolean | Record<string, any>) | null;
  /**
   * Arbitrary JSON value.
   */
  freshness: (string | number | boolean | Record<string, any>) | null;
};

