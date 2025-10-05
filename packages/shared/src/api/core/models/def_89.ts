/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_89 = {
  status: 'unavailable';
  warnings?: Array<string>;
  features: {
    streaming: {
      enabled: boolean;
      state: 'disabled' | 'ready' | 'unconfigured';
      reason?: string | null;
      brokerConfigured: boolean;
    };
  };
};

