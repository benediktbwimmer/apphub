/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_5 = {
  /**
   * Summary health indicator for the filestore service.
   */
  status: 'ok' | 'degraded';
  events: {
    /**
     * Operating mode for filestore event delivery.
     */
    mode: 'inline' | 'redis';
    /**
     * Indicates whether the event publisher is ready.
     */
    ready: boolean;
    /**
     * Most recent connection or publish error, when available.
     */
    lastError: string | null;
  };
};

