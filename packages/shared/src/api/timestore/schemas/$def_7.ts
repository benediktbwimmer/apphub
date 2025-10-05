/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_7 = {
  properties: {
    status: {
      type: 'Enum',
      isRequired: true,
    },
    reason: {
      type: 'string',
      description: `Detailed reason describing why the service is not ready.`,
      isRequired: true,
    },
    lifecycle: {
      properties: {
        inline: {
          type: 'boolean',
          description: `Indicates whether queue processing runs inline instead of Redis-backed.`,
          isRequired: true,
        },
        ready: {
          type: 'boolean',
          description: `True when the lifecycle queue connection is available.`,
          isRequired: true,
        },
        lastError: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
      },
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
