/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $SqlSavedQueryResponse = {
  properties: {
    savedQuery: {
      properties: {
        id: {
          type: 'string',
          isRequired: true,
        },
        statement: {
          type: 'string',
          isRequired: true,
        },
        label: {
          type: 'string',
          isNullable: true,
        },
        stats: {
          properties: {
            rowCount: {
              type: 'number',
              isNullable: true,
            },
            elapsedMs: {
              type: 'number',
              isNullable: true,
            },
          },
          isNullable: true,
        },
        createdBy: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        createdAt: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
        updatedAt: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
      },
      isRequired: true,
    },
  },
} as const;
