/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ReadyResponse = {
  properties: {
    status: {
      type: 'Enum',
      isRequired: true,
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
