/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $WorkflowDefinitionCreateRequest = {
  properties: {
    slug: {
      type: 'string',
      isRequired: true,
      maxLength: 100,
      minLength: 1,
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9-_]*$',
    },
    name: {
      type: 'string',
      isRequired: true,
    },
    version: {
      type: 'number',
      minimum: 1,
    },
    description: {
      type: 'string',
    },
    steps: {
      type: 'array',
      contains: {
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
            timeoutMs: {
              type: 'number',
              isNullable: true,
              maximum: 86400000,
              minimum: 1000,
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
            timeoutMs: {
              type: 'number',
              isNullable: true,
              maximum: 86400000,
              minimum: 1000,
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
              },
              isRequired: true,
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
              isRequired: true,
              isNullable: true,
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
                  timeoutMs: {
                    type: 'number',
                    isNullable: true,
                    maximum: 86400000,
                    minimum: 1000,
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
                  timeoutMs: {
                    type: 'number',
                    isNullable: true,
                    maximum: 86400000,
                    minimum: 1000,
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
        }],
      },
      isRequired: true,
    },
    triggers: {
      type: 'array',
      contains: {
        properties: {
          type: {
            type: 'string',
            isRequired: true,
          },
          options: {
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
        },
      },
    },
    parametersSchema: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    defaultParameters: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    outputSchema: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
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
  },
} as const;
