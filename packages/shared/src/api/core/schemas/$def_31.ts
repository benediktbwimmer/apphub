/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_31 = {
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
      type: 'any-of',
      contains: [{
        type: 'all-of',
        description: `Environment variables declared for the service in manifests, including placeholder metadata.`,
        contains: [{
          type: 'any-of',
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
          }, {
            type: 'null',
          }],
        }],
      }, {
        type: 'null',
      }],
    },
    apps: {
      type: 'any[]',
      description: `IDs of apps that are linked to this service through service networks.`,
      isNullable: true,
    },
    appliedAt: {
      type: 'string',
      description: `Timestamp indicating when this manifest version was applied.`,
      format: 'date-time',
    },
  },
} as const;
