/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_41 = {
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
      type: 'any',
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
} as const;
