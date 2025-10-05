/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_10 = {
  properties: {
    search: {
      type: 'string',
      description: `Search term applied to mount names or descriptions.`,
      isRequired: true,
      isNullable: true,
    },
    kinds: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
    states: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
    accessModes: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
  },
} as const;
