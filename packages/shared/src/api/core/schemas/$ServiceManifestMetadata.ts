/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ServiceManifestMetadata = {
  description: `Metadata sourced from service manifests and configuration files.`,
  properties: {
    source: {
      type: 'string',
      description: `Location of the manifest entry that populated this service.`,
      isNullable: true,
    },
    sources: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    baseUrlSource: {
      type: 'Enum',
      isNullable: true,
    },
    openapiPath: {
      type: 'string',
      isNullable: true,
    },
    healthEndpoint: {
      type: 'string',
      isNullable: true,
    },
    workingDir: {
      type: 'string',
      isNullable: true,
    },
    devCommand: {
      type: 'string',
      isNullable: true,
    },
    env: {
      type: 'all-of',
      description: `Environment variables declared for the service in manifests, including placeholder metadata.`,
      contains: [{
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
      }],
      isNullable: true,
    },
    apps: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isNullable: true,
    },
    appliedAt: {
      type: 'string',
      description: `Timestamp indicating when this manifest version was applied.`,
      format: 'date-time',
    },
  },
} as const;
