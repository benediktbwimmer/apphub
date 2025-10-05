/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_42 = {
  data: {
    id: string;
    slug: string;
    name: string;
    version: number;
    type: 'batch' | 'service-triggered' | 'manual';
    runtime: 'node' | 'python' | 'docker';
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
};

