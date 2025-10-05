/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssetGraphResponse = {
  data: {
    assets: Array<{
      assetId: string;
      normalizedAssetId: string;
      producers: Array<{
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
      }>;
      consumers: Array<{
        workflowId: string;
        workflowSlug: string;
        workflowName: string;
        stepId: string;
        stepName: string;
        stepType: 'job' | 'service' | 'fanout';
      }>;
      latestMaterializations: Array<{
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
      }>;
      stalePartitions: Array<{
        workflowId: string;
        workflowSlug: string;
        workflowName: string;
        partitionKey: string | null;
        requestedAt: string;
        requestedBy: string | null;
        note: string | null;
      }>;
      hasStalePartitions: boolean;
      hasOutdatedUpstreams: boolean;
      outdatedUpstreamAssetIds: Array<string>;
    }>;
    edges: Array<{
      fromAssetId: string;
      fromAssetNormalizedId: string;
      toAssetId: string;
      toAssetNormalizedId: string;
      workflowId: string;
      workflowSlug: string;
      workflowName: string;
      stepId: string;
      stepName: string;
      stepType: 'job' | 'service' | 'fanout';
    }>;
  };
};

