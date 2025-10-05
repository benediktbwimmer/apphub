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
      type: 'any-of',
      description: `Arbitrary JSON value.`,
      contains: [{
        type: 'string',
      }, {
        type: 'number',
      }, {
        type: 'number',
      }, {
        type: 'boolean',
      }, {
        type: 'dictionary',
        contains: {
          properties: {
          },
        },
      }],
      isNullable: true,
    },
    metadata: {
      type: 'all-of',
      description: `Optional metadata describing manifest provenance, linked apps, and runtime expectations.`,
      contains: [{
        type: 'def_33',
      }],
      isNullable: true,
    },
    source: {
      type: 'Enum',
    },
  },
} as const;
