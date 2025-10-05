/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowRun = {
  id: string;
  workflowDefinitionId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  /**
   * Arbitrary JSON value.
   */
  parameters?: (string | number | boolean | Record<string, any>) | null;
  /**
   * Arbitrary JSON value.
   */
  context?: (string | number | boolean | Record<string, any>) | null;
  /**
   * Arbitrary JSON value.
   */
  output?: (string | number | boolean | Record<string, any>) | null;
  errorMessage?: string | null;
  currentStepId?: string | null;
  currentStepIndex?: number | null;
  /**
   * Arbitrary JSON value.
   */
  metrics?: (string | number | boolean | Record<string, any>) | null;
  triggeredBy?: string | null;
  /**
   * Arbitrary JSON value.
   */
  trigger?: (string | number | boolean | Record<string, any>) | null;
  partitionKey?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt: string;
};

