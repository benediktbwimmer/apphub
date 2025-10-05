/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_36 = {
  properties: {
    data: {
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
        },
        metadata: {
          type: 'any',
          description: `Structured metadata describing how a service is sourced, linked, and executed.`,
          isNullable: true,
        },
        openapi: {
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
          type: 'any',
          isNullable: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
