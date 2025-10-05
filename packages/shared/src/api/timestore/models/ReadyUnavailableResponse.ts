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
      state: 'disabled' | 'ready' | 'degraded' | 'unconfigured';
      reason: string | null;
      broker: {
        configured: boolean;
        reachable: boolean | null;
        lastCheckedAt: string | null;
        error: string | null;
      };
      batchers: {
        configured: number;
        running: number;
        failing: number;
        state: 'disabled' | 'ready' | 'degraded';
        connectors: Array<{
          connectorId: string;
          datasetSlug: string;
          topic: string;
          groupId: string;
          state: 'starting' | 'running' | 'stopped' | 'error';
          bufferedWindows: number;
          bufferedRows: number;
          openWindows: number;
          lastMessageAt: string | null;
          lastFlushAt: string | null;
          lastEventTimestamp: string | null;
          lastError: string | null;
        }>;
      };
      hotBuffer: {
        enabled: boolean;
        state: 'disabled' | 'ready' | 'unavailable';
        datasets: number;
        healthy: boolean;
        lastRefreshAt: string | null;
        lastIngestAt: string | null;
      };
      mirrors?: Record<string, boolean>;
    };
  };
};

