/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowAutoMaterializeInFlight = {
  workflowRunId?: string | null;
  reason: string;
  assetId?: string | null;
  partitionKey?: string | null;
  requestedAt: string;
  claimedAt: string;
  claimOwner: string;
  /**
   * Arbitrary JSON value.
   */
  context?: (string | number | boolean | Record<string, any>) | null;
};

