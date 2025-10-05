/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $PythonSnippetCreateResponse = {
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
              type: 'dictionary',
              contains: {
                properties: {
                },
              },
              isRequired: true,
              isNullable: true,
            },
            defaultParameters: {
              type: 'dictionary',
              contains: {
                properties: {
                },
              },
              isRequired: true,
              isNullable: true,
            },
            outputSchema: {
              type: 'dictionary',
              contains: {
                properties: {
                },
              },
              isRequired: true,
              isNullable: true,
            },
            timeoutMs: {
              type: 'number',
              isNullable: true,
            },
            retryPolicy: {
              properties: {
                maxAttempts: {
                  type: 'number',
                  maximum: 10,
                  minimum: 1,
                },
                strategy: {
                  type: 'Enum',
                },
                initialDelayMs: {
                  type: 'number',
                  maximum: 86400000,
                },
                maxDelayMs: {
                  type: 'number',
                  maximum: 86400000,
                },
                jitter: {
                  type: 'Enum',
                },
              },
              isNullable: true,
            },
            metadata: {
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
        analysis: {
          properties: {
            handlerName: {
              type: 'string',
              isRequired: true,
            },
            handlerIsAsync: {
              type: 'boolean',
              isRequired: true,
            },
            inputModel: {
              properties: {
                name: {
                  type: 'string',
                  isRequired: true,
                },
                schema: {
                  type: 'def_0',
                  isRequired: true,
                },
              },
              isRequired: true,
            },
            outputModel: {
              properties: {
                name: {
                  type: 'string',
                  isRequired: true,
                },
                schema: {
                  type: 'def_0',
                  isRequired: true,
                },
              },
              isRequired: true,
            },
          },
          isRequired: true,
        },
        bundle: {
          properties: {
            slug: {
              type: 'string',
              isRequired: true,
            },
            version: {
              type: 'string',
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
