/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $FilestoreHealth = {
  properties: {
    status: {
      type: 'Enum',
      isRequired: true,
    },
    enabled: {
      type: 'boolean',
      isRequired: true,
    },
    inline: {
      type: 'boolean',
      isRequired: true,
    },
    thresholdSeconds: {
      type: 'number',
      isRequired: true,
      minimum: 1,
    },
    lagSeconds: {
      type: 'number',
      isNullable: true,
    },
    lastEvent: {
      properties: {
        type: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        observedAt: {
          type: 'string',
          isRequired: true,
          isNullable: true,
          format: 'date-time',
        },
        receivedAt: {
          type: 'string',
          isRequired: true,
          isNullable: true,
          format: 'date-time',
        },
      },
      isRequired: true,
    },
    retries: {
      properties: {
        connect: {
          type: 'number',
          isRequired: true,
        },
        processing: {
          type: 'number',
          isRequired: true,
        },
        total: {
          type: 'number',
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
