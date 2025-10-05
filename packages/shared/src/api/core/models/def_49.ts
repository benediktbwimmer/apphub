/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_49 = {
  data: {
    job: {
      id: string;
      slug: string;
      name: string;
      version: number;
      type: 'batch' | 'service-triggered' | 'manual';
      runtime: 'node' | 'python' | 'docker' | 'module';
      entryPoint: string;
      parametersSchema: any | null;
      defaultParameters: any | null;
      outputSchema: any | null;
      timeoutMs?: number | null;
      retryPolicy?: any | null;
      metadata?: ((string | number | boolean | Record<string, any>) | null);
      createdAt: string;
      updatedAt: string;
    };
    runs: Array<{
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
    }>;
  };
  meta: {
    limit: number;
    offset: number;
  };
};

