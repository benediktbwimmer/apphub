/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_67 = {
  id: string;
  workflowDefinitionId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  parameters?: ((string | number | boolean | Record<string, any>) | null);
  context?: ((string | number | boolean | Record<string, any>) | null);
  output?: ((string | number | boolean | Record<string, any>) | null);
  errorMessage?: string | null;
  currentStepId?: string | null;
  currentStepIndex?: number | null;
  metrics?: ((string | number | boolean | Record<string, any>) | null);
  triggeredBy?: string | null;
  trigger?: ((string | number | boolean | Record<string, any>) | null);
  partitionKey?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt: string;
};

