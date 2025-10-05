/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type EventsHealth = {
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

