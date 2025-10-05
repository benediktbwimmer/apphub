/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_17 = {
  properties: {
    name: {
      type: 'string',
      isRequired: true,
      maxLength: 100,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    searchInput: {
      type: 'string',
      maxLength: 500,
    },
    statusFilters: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    sort: {
      type: 'string',
      description: `Preferred sort mode for rendering results.`,
      maxLength: 100,
    },
    category: {
      type: 'string',
      description: `Logical grouping for the saved search (e.g. core, runs).`,
      maxLength: 100,
    },
    config: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
    },
  },
} as const;
