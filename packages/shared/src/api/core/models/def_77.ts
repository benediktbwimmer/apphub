/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_77 = {
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

