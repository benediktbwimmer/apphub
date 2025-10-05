/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_46 = {
  id: string;
  jobDefinitionId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'expired';
  parameters: def_0;
  result: def_0;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics: def_0;
  context: def_0;
  timeoutMs?: number | null;
  attempt: number;
  maxAttempts?: number | null;
  durationMs?: number | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

