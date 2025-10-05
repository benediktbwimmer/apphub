/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type PythonSnippetCreateResponse = {
  data: {
    job: {
      id: string;
      slug: string;
      name: string;
      version: number;
      type: 'batch' | 'service-triggered' | 'manual';
      runtime: 'node' | 'python' | 'docker' | 'module';
      entryPoint: string;
      parametersSchema: Record<string, any> | null;
      defaultParameters: Record<string, any> | null;
      outputSchema: Record<string, any> | null;
      timeoutMs?: number | null;
      retryPolicy?: {
        maxAttempts?: number;
        strategy?: 'none' | 'fixed' | 'exponential';
        initialDelayMs?: number;
        maxDelayMs?: number;
        jitter?: 'none' | 'full' | 'equal';
      } | null;
      /**
       * Arbitrary JSON value.
       */
      metadata?: (string | number | boolean | Record<string, any>) | null;
      createdAt: string;
      updatedAt: string;
    };
    analysis: {
      handlerName: string;
      handlerIsAsync: boolean;
      inputModel: {
        name: string;
        schema: def_0;
      };
      outputModel: {
        name: string;
        schema: def_0;
      };
    };
    bundle: {
      slug: string;
      version: string;
    };
  };
};

