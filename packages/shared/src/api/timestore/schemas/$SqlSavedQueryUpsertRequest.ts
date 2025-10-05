/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $SqlSavedQueryUpsertRequest = {
  properties: {
    statement: {
      type: 'string',
      description: `SQL statement to persist.`,
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
  },
} as const;
