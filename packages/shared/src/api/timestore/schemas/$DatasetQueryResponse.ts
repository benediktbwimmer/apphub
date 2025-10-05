/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $DatasetQueryResponse = {
  properties: {
    rows: {
      type: 'array',
      contains: {
        type: 'dictionary',
        contains: {
          properties: {
          },
        },
      },
      isRequired: true,
    },
    columns: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    mode: {
      type: 'Enum',
      isRequired: true,
    },
    warnings: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    streaming: {
      properties: {
        enabled: {
          type: 'boolean',
          description: `Indicates whether streaming integration was active for the query.`,
          isRequired: true,
        },
        bufferState: {
          type: 'Enum',
          isRequired: true,
        },
        rows: {
          type: 'number',
          description: `Number of streaming rows merged into the response.`,
          isRequired: true,
        },
        watermark: {
          type: 'string',
          isNullable: true,
          format: 'date-time',
        },
        latestTimestamp: {
          type: 'string',
          isNullable: true,
          format: 'date-time',
        },
        fresh: {
          type: 'boolean',
          description: `True when streaming data covers the requested range end.`,
          isRequired: true,
        },
      },
      isNullable: true,
    },
  },
} as const;
