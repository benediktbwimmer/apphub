/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $PresignedDownloadEnvelope = {
  properties: {
    data: {
      properties: {
        url: {
          type: 'string',
          description: `Presigned URL to download the file directly from the backend.`,
          isRequired: true,
        },
        expiresAt: {
          type: 'string',
          description: `Timestamp when the presigned URL expires.`,
          isRequired: true,
          format: 'date-time',
        },
        headers: {
          type: 'dictionary',
          contains: {
            type: 'string',
          },
          isRequired: true,
        },
        method: {
          type: 'string',
          description: `HTTP method to use for the presigned request.`,
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
