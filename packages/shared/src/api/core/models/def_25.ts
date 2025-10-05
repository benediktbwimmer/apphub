/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_25 = {
  name?: string;
  description?: string | null;
  filters?: {
    type?: string;
    source?: string;
    correlationId?: string;
    from?: string;
    to?: string;
    jsonPath?: string;
    severity?: Array<'critical' | 'error' | 'warning' | 'info' | 'debug'>;
    limit?: number;
  };
  visibility?: 'private' | 'shared';
};

