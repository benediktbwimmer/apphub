/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_4 = {
  /**
   * High-level health indicator for the service.
   */
  status: 'ok' | 'degraded';
  lifecycle: {
    /**
     * Indicates whether queue processing runs inline instead of Redis-backed.
     */
    inline: boolean;
    /**
     * True when the lifecycle queue connection is available.
     */
    ready: boolean;
    lastError: string | null;
  };
  features: {
    streaming: {
      enabled: boolean;
      state: 'disabled' | 'ready' | 'unconfigured';
      reason?: string | null;
      brokerConfigured: boolean;
    };
  };
};

