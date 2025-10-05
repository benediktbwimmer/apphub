/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_92 = {
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

