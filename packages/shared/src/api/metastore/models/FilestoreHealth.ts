/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type FilestoreHealth = {
  status: 'disabled' | 'ok' | 'stalled';
  enabled: boolean;
  inline: boolean;
  thresholdSeconds: number;
  lagSeconds?: number | null;
  lastEvent: {
    type: string | null;
    observedAt: string | null;
    receivedAt: string | null;
  };
  retries: {
    connect: number;
    processing: number;
    total: number;
  };
};

