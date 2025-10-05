/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_92 = {
  properties: {
    configured: {
      type: 'number',
      isRequired: true,
    },
    running: {
      type: 'number',
      isRequired: true,
    },
    failing: {
      type: 'number',
      isRequired: true,
    },
    state: {
      type: 'Enum',
      isRequired: true,
    },
    connectors: {
      type: 'array',
      contains: {
        properties: {
          connectorId: {
            type: 'string',
            isRequired: true,
          },
          datasetSlug: {
            type: 'string',
            isRequired: true,
          },
          topic: {
            type: 'string',
            isRequired: true,
          },
          groupId: {
            type: 'string',
            isRequired: true,
          },
          state: {
            type: 'Enum',
            isRequired: true,
          },
          bufferedWindows: {
            type: 'number',
            isRequired: true,
          },
          bufferedRows: {
            type: 'number',
            isRequired: true,
          },
          openWindows: {
            type: 'number',
            isRequired: true,
          },
          lastMessageAt: {
            type: 'string',
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          lastFlushAt: {
            type: 'string',
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          lastEventTimestamp: {
            type: 'string',
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          lastError: {
            type: 'string',
            isRequired: true,
            isNullable: true,
          },
        },
      },
      isRequired: true,
    },
  },
} as const;
