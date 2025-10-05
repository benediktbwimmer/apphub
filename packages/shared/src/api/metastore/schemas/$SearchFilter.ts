/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $SearchFilter = {
  type: 'one-of',
  contains: [{
    properties: {
      type: {
        type: 'Enum',
      },
      field: {
        type: 'string',
        isRequired: true,
      },
      operator: {
        type: 'Enum',
        isRequired: true,
      },
      value: {
        properties: {
        },
      },
      values: {
        type: 'array',
        contains: {
          properties: {
          },
        },
      },
    },
  }, {
    properties: {
      type: {
        type: 'Enum',
        isRequired: true,
      },
      operator: {
        type: 'Enum',
        isRequired: true,
      },
      filters: {
        type: 'array',
        contains: {
          type: 'SearchFilter',
        },
        isRequired: true,
      },
    },
  }, {
    properties: {
      type: {
        type: 'Enum',
        isRequired: true,
      },
      filter: {
        type: 'SearchFilter',
        isRequired: true,
      },
    },
  }],
} as const;
