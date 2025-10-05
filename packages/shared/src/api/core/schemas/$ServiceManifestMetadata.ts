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
      type: 'array',
      contains: {
        description: `Environment variable declared in a service manifest.`,
        properties: {
          key: {
            type: 'string',
            isRequired: true,
            minLength: 1,
          },
          value: {
            type: 'one-of',
            contains: [{
              type: 'string',
            }, {
              properties: {
                $var: {
                  properties: {
                    name: {
                      type: 'string',
                      isRequired: true,
                      minLength: 1,
                    },
                    default: {
                      type: 'string',
                    },
                    description: {
                      type: 'string',
                    },
                  },
                  isRequired: true,
                },
              },
            }],
          },
          fromService: {
            properties: {
              service: {
                type: 'string',
                isRequired: true,
                minLength: 1,
              },
              property: {
                type: 'Enum',
                isRequired: true,
              },
              fallback: {
                type: 'string',
              },
            },
          },
        },
      },
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
