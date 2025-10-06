/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowAutoMaterializeAssetUpdateRequest = {
  stepId: string;
  enabled?: boolean;
  onUpstreamUpdate?: boolean;
  priority?: number | null;
  /**
   * Arbitrary JSON value.
   */
  parameterDefaults?: (string | number | boolean | Record<string, any>) | null;
};

