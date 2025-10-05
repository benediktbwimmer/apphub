/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $EventSavedViewUpdateRequest = {
  properties: {
    name: {
      type: 'string',
      maxLength: 120,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    filters: {
      properties: {
        type: {
          type: 'string',
          maxLength: 200,
        },
        source: {
          type: 'string',
          maxLength: 200,
        },
        correlationId: {
          type: 'string',
          maxLength: 200,
        },
        from: {
          type: 'string',
          format: 'date-time',
        },
        to: {
          type: 'string',
          format: 'date-time',
        },
        jsonPath: {
          type: 'string',
          maxLength: 500,
        },
        severity: {
          type: 'array',
          contains: {
            type: 'Enum',
          },
        },
        limit: {
          type: 'number',
          maximum: 200,
          minimum: 1,
        },
      },
    },
    visibility: {
      type: 'Enum',
    },
  },
} as const;
