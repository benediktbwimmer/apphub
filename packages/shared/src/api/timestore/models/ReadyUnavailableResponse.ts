/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReadyUnavailableResponse = {
  /**
   * Indicates the readiness check failed.
   */
  status: 'unavailable';
  /**
   * Detailed reason describing why the service is not ready.
   */
  reason: string;
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

