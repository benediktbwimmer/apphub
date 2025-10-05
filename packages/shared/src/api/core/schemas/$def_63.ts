/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_63 = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    name: {
      type: 'string',
      isRequired: true,
    },
    type: {
      type: 'Enum',
      isRequired: true,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    dependsOn: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    collection: {
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
      isRequired: true,
    },
    template: {
      type: 'one-of',
      contains: [{
        properties: {
          id: {
            type: 'string',
            isRequired: true,
          },
          name: {
            type: 'string',
            isRequired: true,
          },
          type: {
            type: 'Enum',
          },
          jobSlug: {
            type: 'string',
            isRequired: true,
          },
          description: {
            type: 'string',
            isNullable: true,
          },
          dependsOn: {
            type: 'array',
            contains: {
              type: 'string',
            },
          },
          parameters: {
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
          timeoutMs: {
            type: 'number',
            isNullable: true,
            maximum: 86400000,
            minimum: 1000,
          },
          retryPolicy: {
            type: 'any',
            isNullable: true,
          },
          storeResultAs: {
            type: 'string',
            isNullable: true,
          },
        },
      }, {
        properties: {
          id: {
            type: 'string',
            isRequired: true,
          },
          name: {
            type: 'string',
            isRequired: true,
          },
          type: {
            type: 'Enum',
            isRequired: true,
          },
          serviceSlug: {
            type: 'string',
            isRequired: true,
          },
          description: {
            type: 'string',
            isNullable: true,
          },
          dependsOn: {
            type: 'array',
            contains: {
              type: 'string',
            },
          },
          parameters: {
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
          timeoutMs: {
            type: 'number',
            isNullable: true,
            maximum: 86400000,
            minimum: 1000,
          },
          retryPolicy: {
            type: 'any',
            isNullable: true,
          },
          requireHealthy: {
            type: 'boolean',
          },
          allowDegraded: {
            type: 'boolean',
          },
          captureResponse: {
            type: 'boolean',
          },
          storeResponseAs: {
            type: 'string',
          },
          request: {
            properties: {
              path: {
                type: 'string',
                isRequired: true,
              },
              method: {
                type: 'Enum',
              },
              headers: {
                type: 'dictionary',
                contains: {
                  type: 'one-of',
                  contains: [{
                    type: 'string',
                  }, {
                    properties: {
                      secret: {
                        properties: {
                          source: {
                            type: 'Enum',
                            isRequired: true,
                          },
                          key: {
                            type: 'string',
                            isRequired: true,
                          },
                          version: {
                            type: 'string',
                          },
                        },
                        isRequired: true,
                      },
                      prefix: {
                        type: 'string',
                      },
                    },
                  }],
                },
              },
              query: {
                type: 'dictionary',
                contains: {
                  type: 'one-of',
                  contains: [{
                    type: 'string',
                  }, {
                    type: 'number',
                  }, {
                    type: 'boolean',
                  }],
                },
              },
              body: {
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
            },
            isRequired: true,
          },
        },
      }],
      isRequired: true,
    },
    maxItems: {
      type: 'number',
      isNullable: true,
      maximum: 10000,
      minimum: 1,
    },
    maxConcurrency: {
      type: 'number',
      isNullable: true,
      maximum: 1000,
      minimum: 1,
    },
    storeResultsAs: {
      type: 'string',
    },
  },
} as const;
