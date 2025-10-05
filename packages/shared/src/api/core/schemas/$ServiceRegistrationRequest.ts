/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ServiceRegistrationRequest = {
  properties: {
    slug: {
      type: 'string',
      description: `Unique identifier for the service.`,
      isRequired: true,
    },
    displayName: {
      type: 'string',
      isRequired: true,
    },
    kind: {
      type: 'string',
      description: `Service kind or integration type.`,
      isRequired: true,
    },
    baseUrl: {
      type: 'string',
      isRequired: true,
      format: 'uri',
    },
    status: {
      type: 'Enum',
    },
    statusMessage: {
      type: 'string',
      isNullable: true,
    },
    capabilities: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    metadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    source: {
      type: 'Enum',
    },
  },
} as const;
