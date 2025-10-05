/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_49 = {
  properties: {
    data: {
      properties: {
        job: {
          properties: {
            id: {
              type: 'string',
              isRequired: true,
            },
            slug: {
              type: 'string',
              isRequired: true,
            },
            name: {
              type: 'string',
              isRequired: true,
            },
            version: {
              type: 'number',
              isRequired: true,
            },
            type: {
              type: 'Enum',
              isRequired: true,
            },
            runtime: {
              type: 'Enum',
              isRequired: true,
            },
            entryPoint: {
              type: 'string',
              isRequired: true,
            },
            parametersSchema: {
              type: 'any',
              isRequired: true,
              isNullable: true,
            },
            defaultParameters: {
              type: 'any',
              isRequired: true,
              isNullable: true,
            },
            outputSchema: {
              type: 'any',
              isRequired: true,
              isNullable: true,
            },
            timeoutMs: {
              type: 'number',
              isNullable: true,
            },
            retryPolicy: {
              type: 'any',
              isNullable: true,
            },
            metadata: {
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
          },
          isRequired: true,
        },
        runs: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              jobDefinitionId: {
                type: 'string',
                isRequired: true,
              },
              status: {
                type: 'Enum',
                isRequired: true,
              },
              parameters: {
                type: 'def_0',
                isRequired: true,
              },
              result: {
                type: 'def_0',
                isRequired: true,
              },
              errorMessage: {
                type: 'string',
                isNullable: true,
              },
              logsUrl: {
                type: 'string',
                isNullable: true,
                format: 'uri',
              },
              metrics: {
                type: 'def_0',
                isRequired: true,
              },
              context: {
                type: 'def_0',
                isRequired: true,
              },
              timeoutMs: {
                type: 'number',
                isNullable: true,
              },
              attempt: {
                type: 'number',
                isRequired: true,
                minimum: 1,
              },
              maxAttempts: {
                type: 'number',
                isNullable: true,
                minimum: 1,
              },
              durationMs: {
                type: 'number',
                isNullable: true,
              },
              scheduledAt: {
                type: 'string',
                isNullable: true,
                format: 'date-time',
              },
              startedAt: {
                type: 'string',
                isNullable: true,
                format: 'date-time',
              },
              completedAt: {
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
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
    meta: {
      properties: {
        limit: {
          type: 'number',
          isRequired: true,
          maximum: 50,
          minimum: 1,
        },
        offset: {
          type: 'number',
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
