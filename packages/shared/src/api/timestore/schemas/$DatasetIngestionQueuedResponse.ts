/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $DatasetIngestionQueuedResponse = {
  properties: {
    mode: {
      type: 'Enum',
      isRequired: true,
    },
    jobId: {
      type: 'string',
      description: `Identifier of the enqueued ingestion job.`,
      isRequired: true,
    },
  },
} as const;
