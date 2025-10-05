/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_37 = {
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
      type: 'any',
      description: `Optional capability metadata exposed by the service.`,
      isNullable: true,
    },
    metadata: {
      type: 'any',
      description: `Optional metadata describing manifest provenance, linked apps, and runtime expectations.`,
      isNullable: true,
    },
    source: {
      type: 'Enum',
    },
  },
} as const;
