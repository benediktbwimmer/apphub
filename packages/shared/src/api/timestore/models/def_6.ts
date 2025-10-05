/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_6 = {
  /**
   * Indicates the service is ready to receive traffic.
   */
  status: 'ready';
  features: {
    streaming: {
      enabled: boolean;
      state: 'disabled' | 'ready' | 'unconfigured';
      reason?: string | null;
      brokerConfigured: boolean;
    };
  };
};

