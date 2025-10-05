/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ServiceListResponse = {
  properties: {
    data: {
      type: 'array',
      contains: {
        properties: {
          id: {
            type: 'string',
            isRequired: true,
          },
          slug: {
            type: 'string',
            isRequired: true,
          },
          displayName: {
            type: 'string',
            isRequired: true,
          },
          kind: {
            type: 'string',
            isRequired: true,
          },
          baseUrl: {
            type: 'string',
            isRequired: true,
            format: 'uri',
          },
          source: {
            type: 'Enum',
            isRequired: true,
          },
          status: {
            type: 'Enum',
            isRequired: true,
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
            type: 'dictionary',
            contains: {
              properties: {
              },
            },
            isNullable: true,
          },
          openapi: {
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
          lastHealthyAt: {
            type: 'string',
            isNullable: true,
            format: 'date-time',
          },
          createdAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          health: {
            properties: {
              status: {
                type: 'Enum',
              },
              statusMessage: {
                type: 'string',
                isNullable: true,
              },
              checkedAt: {
                type: 'string',
                isNullable: true,
                format: 'date-time',
              },
              latencyMs: {
                type: 'number',
                isNullable: true,
              },
              statusCode: {
                type: 'number',
                isNullable: true,
              },
              baseUrl: {
                type: 'string',
                isNullable: true,
              },
              healthEndpoint: {
                type: 'string',
                isNullable: true,
              },
            },
            isNullable: true,
          },
        },
      },
      isRequired: true,
    },
    meta: {
      properties: {
        total: {
          type: 'number',
          isRequired: true,
        },
        healthyCount: {
          type: 'number',
          isRequired: true,
        },
        unhealthyCount: {
          type: 'number',
          isRequired: true,
        },
        filters: {
          properties: {
            source: {
              type: 'Enum',
            },
          },
          isNullable: true,
        },
        sourceCounts: {
          properties: {
            module: {
              type: 'number',
              isRequired: true,
            },
            external: {
              type: 'number',
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
