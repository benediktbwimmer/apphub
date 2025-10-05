/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_88 = {
  properties: {
    status: {
      type: 'Enum',
      isRequired: true,
    },
    warnings: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    features: {
      properties: {
        streaming: {
          properties: {
            enabled: {
              type: 'boolean',
              isRequired: true,
            },
            state: {
              type: 'Enum',
              isRequired: true,
            },
            reason: {
              type: 'string',
              isNullable: true,
            },
            brokerConfigured: {
              type: 'boolean',
              isRequired: true,
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
