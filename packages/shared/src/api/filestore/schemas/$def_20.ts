/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_20 = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend filter applied to the query.`,
      isRequired: true,
    },
    path: {
      type: 'string',
      description: `Optional path prefix filter.`,
      isRequired: true,
      isNullable: true,
    },
    depth: {
      type: 'number',
      description: `Maximum depth relative to the provided path.`,
      isRequired: true,
      isNullable: true,
    },
    states: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
    kinds: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
    search: {
      type: 'string',
      description: `Term supplied via search or advanced filters.`,
      isRequired: true,
      isNullable: true,
    },
    driftOnly: {
      type: 'boolean',
      description: `Whether only nodes with detected drift were requested.`,
      isRequired: true,
    },
    advanced: {
      type: 'any',
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
