/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_84 = {
  properties: {
    version: {
      type: 'Enum',
      isRequired: true,
    },
    generatedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    nodes: {
      properties: {
        workflows: {
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
              name: {
                type: 'string',
                isRequired: true,
              },
              version: {
                type: 'number',
                isRequired: true,
              },
              description: {
                type: 'string',
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
              metadata: {
                type: 'any',
                isNullable: true,
              },
              annotations: {
                properties: {
                  tags: {
                    type: 'array',
                    contains: {
                      type: 'string',
                    },
                    isRequired: true,
                  },
                  ownerName: {
                    type: 'string',
                    isNullable: true,
                  },
                  ownerContact: {
                    type: 'string',
                    isNullable: true,
                  },
                  team: {
                    type: 'string',
                    isNullable: true,
                  },
                  domain: {
                    type: 'string',
                    isNullable: true,
                  },
                  environment: {
                    type: 'string',
                    isNullable: true,
                  },
                  slo: {
                    type: 'string',
                    isNullable: true,
                  },
                },
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        steps: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              workflowId: {
                type: 'string',
                isRequired: true,
              },
              name: {
                type: 'string',
                isRequired: true,
              },
              description: {
                type: 'string',
                isNullable: true,
              },
              type: {
                type: 'Enum',
                isRequired: true,
              },
              dependsOn: {
                type: 'array',
                contains: {
                  type: 'string',
                },
                isRequired: true,
              },
              dependents: {
                type: 'array',
                contains: {
                  type: 'string',
                },
                isRequired: true,
              },
              runtime: {
                type: 'one-of',
                contains: [{
                  properties: {
                    type: {
                      type: 'Enum',
                      isRequired: true,
                    },
                    jobSlug: {
                      type: 'string',
                      isRequired: true,
                    },
                    bundleStrategy: {
                      type: 'Enum',
                    },
                    bundleSlug: {
                      type: 'string',
                      isNullable: true,
                    },
                    bundleVersion: {
                      type: 'string',
                      isNullable: true,
                    },
                    exportName: {
                      type: 'string',
                      isNullable: true,
                    },
                    timeoutMs: {
                      type: 'number',
                      isNullable: true,
                    },
                  },
                }, {
                  properties: {
                    type: {
                      type: 'Enum',
                      isRequired: true,
                    },
                    serviceSlug: {
                      type: 'string',
                      isRequired: true,
                    },
                    timeoutMs: {
                      type: 'number',
                      isNullable: true,
                    },
                    requireHealthy: {
                      type: 'boolean',
                      isNullable: true,
                    },
                    allowDegraded: {
                      type: 'boolean',
                      isNullable: true,
                    },
                    captureResponse: {
                      type: 'boolean',
                      isNullable: true,
                    },
                  },
                }, {
                  properties: {
                    type: {
                      type: 'Enum',
                      isRequired: true,
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
                    maxItems: {
                      type: 'number',
                      isNullable: true,
                    },
                    maxConcurrency: {
                      type: 'number',
                      isNullable: true,
                    },
                    storeResultsAs: {
                      type: 'string',
                      isNullable: true,
                    },
                    template: {
                      properties: {
                        id: {
                          type: 'string',
                          isRequired: true,
                        },
                        name: {
                          type: 'string',
                          isNullable: true,
                        },
                        runtime: {
                          type: 'one-of',
                          contains: [{
                            properties: {
                              type: {
                                type: 'Enum',
                                isRequired: true,
                              },
                              jobSlug: {
                                type: 'string',
                                isRequired: true,
                              },
                              bundleStrategy: {
                                type: 'Enum',
                              },
                              bundleSlug: {
                                type: 'string',
                                isNullable: true,
                              },
                              bundleVersion: {
                                type: 'string',
                                isNullable: true,
                              },
                              exportName: {
                                type: 'string',
                                isNullable: true,
                              },
                              timeoutMs: {
                                type: 'number',
                                isNullable: true,
                              },
                            },
                          }, {
                            properties: {
                              type: {
                                type: 'Enum',
                                isRequired: true,
                              },
                              serviceSlug: {
                                type: 'string',
                                isRequired: true,
                              },
                              timeoutMs: {
                                type: 'number',
                                isNullable: true,
                              },
                              requireHealthy: {
                                type: 'boolean',
                                isNullable: true,
                              },
                              allowDegraded: {
                                type: 'boolean',
                                isNullable: true,
                              },
                              captureResponse: {
                                type: 'boolean',
                                isNullable: true,
                              },
                            },
                          }],
                          isRequired: true,
                        },
                      },
                      isRequired: true,
                    },
                  },
                }],
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        triggers: {
          type: 'array',
          contains: {
            type: 'one-of',
            contains: [{
              properties: {
                id: {
                  type: 'string',
                  isRequired: true,
                },
                workflowId: {
                  type: 'string',
                  isRequired: true,
                },
                kind: {
                  type: 'Enum',
                  isRequired: true,
                },
                triggerType: {
                  type: 'string',
                  isRequired: true,
                },
                options: {
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
                schedule: {
                  type: 'any-of',
                  contains: [{
                    type: 'all-of',
                    contains: [{
                      properties: {
                        cron: {
                          type: 'string',
                          isRequired: true,
                        },
                        timezone: {
                          type: 'string',
                          isNullable: true,
                        },
                        startWindow: {
                          type: 'string',
                          isNullable: true,
                        },
                        endWindow: {
                          type: 'string',
                          isNullable: true,
                        },
                        catchUp: {
                          type: 'boolean',
                          isNullable: true,
                        },
                      },
                    }],
                  }, {
                    type: 'null',
                  }],
                },
              },
            }, {
              properties: {
                id: {
                  type: 'string',
                  isRequired: true,
                },
                workflowId: {
                  type: 'string',
                  isRequired: true,
                },
                kind: {
                  type: 'Enum',
                  isRequired: true,
                },
                name: {
                  type: 'string',
                  isNullable: true,
                },
                description: {
                  type: 'string',
                  isNullable: true,
                },
                status: {
                  type: 'Enum',
                  isRequired: true,
                },
                eventType: {
                  type: 'string',
                  isRequired: true,
                },
                eventSource: {
                  type: 'string',
                  isNullable: true,
                },
                predicates: {
                  type: 'array',
                  contains: {
                    properties: {
                      type: {
                        type: 'Enum',
                        isRequired: true,
                      },
                      path: {
                        type: 'string',
                        isRequired: true,
                      },
                      operator: {
                        type: 'string',
                        isRequired: true,
                      },
                      value: {
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
                      values: {
                        type: 'array',
                        contains: {
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
                      caseSensitive: {
                        type: 'boolean',
                      },
                      flags: {
                        type: 'string',
                        isNullable: true,
                      },
                    },
                  },
                  isRequired: true,
                },
                parameterTemplate: {
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
                runKeyTemplate: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
                throttleWindowMs: {
                  type: 'number',
                  isRequired: true,
                  isNullable: true,
                },
                throttleCount: {
                  type: 'number',
                  isRequired: true,
                  isNullable: true,
                },
                maxConcurrency: {
                  type: 'number',
                  isRequired: true,
                  isNullable: true,
                },
                idempotencyKeyExpression: {
                  type: 'string',
                  isRequired: true,
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
                  isRequired: true,
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
                createdBy: {
                  type: 'string',
                  isNullable: true,
                },
                updatedBy: {
                  type: 'string',
                  isNullable: true,
                },
              },
            }],
          },
          isRequired: true,
        },
        schedules: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              workflowId: {
                type: 'string',
                isRequired: true,
              },
              name: {
                type: 'string',
                isNullable: true,
              },
              description: {
                type: 'string',
                isNullable: true,
              },
              cron: {
                type: 'string',
                isRequired: true,
              },
              timezone: {
                type: 'string',
                isRequired: true,
                isNullable: true,
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
                isRequired: true,
              },
              startWindow: {
                type: 'string',
                isRequired: true,
                isNullable: true,
              },
              endWindow: {
                type: 'string',
                isRequired: true,
                isNullable: true,
              },
              catchUp: {
                type: 'boolean',
                isRequired: true,
              },
              nextRunAt: {
                type: 'string',
                isRequired: true,
                isNullable: true,
                format: 'date-time',
              },
              isActive: {
                type: 'boolean',
                isRequired: true,
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
        assets: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              assetId: {
                type: 'string',
                isRequired: true,
              },
              normalizedAssetId: {
                type: 'string',
                isRequired: true,
              },
              annotations: {
                properties: {
                  tags: {
                    type: 'array',
                    contains: {
                      type: 'string',
                    },
                    isRequired: true,
                  },
                  ownerName: {
                    type: 'string',
                    isNullable: true,
                  },
                  ownerContact: {
                    type: 'string',
                    isNullable: true,
                  },
                  team: {
                    type: 'string',
                    isNullable: true,
                  },
                  domain: {
                    type: 'string',
                    isNullable: true,
                  },
                  environment: {
                    type: 'string',
                    isNullable: true,
                  },
                  slo: {
                    type: 'string',
                    isNullable: true,
                  },
                },
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        eventSources: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              eventType: {
                type: 'string',
                isRequired: true,
              },
              eventSource: {
                type: 'string',
                isNullable: true,
              },
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
    edges: {
      properties: {
        triggerToWorkflow: {
          type: 'array',
          contains: {
            type: 'one-of',
            contains: [{
              properties: {
                kind: {
                  type: 'Enum',
                  isRequired: true,
                },
                triggerId: {
                  type: 'string',
                  isRequired: true,
                },
                workflowId: {
                  type: 'string',
                  isRequired: true,
                },
              },
            }, {
              properties: {
                kind: {
                  type: 'Enum',
                  isRequired: true,
                },
                scheduleId: {
                  type: 'string',
                  isRequired: true,
                },
                workflowId: {
                  type: 'string',
                  isRequired: true,
                },
              },
            }],
          },
          isRequired: true,
        },
        workflowToStep: {
          type: 'array',
          contains: {
            properties: {
              workflowId: {
                type: 'string',
                isRequired: true,
              },
              fromStepId: {
                type: 'string',
                isNullable: true,
              },
              toStepId: {
                type: 'string',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        stepToAsset: {
          type: 'array',
          contains: {
            properties: {
              workflowId: {
                type: 'string',
                isRequired: true,
              },
              stepId: {
                type: 'string',
                isRequired: true,
              },
              assetId: {
                type: 'string',
                isRequired: true,
              },
              normalizedAssetId: {
                type: 'string',
                isRequired: true,
              },
              direction: {
                type: 'Enum',
                isRequired: true,
              },
              freshness: {
                type: 'any',
                isNullable: true,
              },
              partitioning: {
                type: 'any-of',
                contains: [{
                  type: 'one-of',
                  contains: [{
                    properties: {
                      type: {
                        type: 'Enum',
                        isRequired: true,
                      },
                      granularity: {
                        type: 'Enum',
                        isRequired: true,
                      },
                      timezone: {
                        type: 'string',
                        isNullable: true,
                      },
                      format: {
                        type: 'string',
                        isNullable: true,
                      },
                      lookbackWindows: {
                        type: 'number',
                        isNullable: true,
                      },
                    },
                  }, {
                    properties: {
                      type: {
                        type: 'Enum',
                        isRequired: true,
                      },
                      keys: {
                        type: 'array',
                        contains: {
                          type: 'string',
                        },
                        isRequired: true,
                      },
                    },
                  }, {
                    properties: {
                      type: {
                        type: 'Enum',
                        isRequired: true,
                      },
                      maxKeys: {
                        type: 'number',
                        isNullable: true,
                      },
                      retentionDays: {
                        type: 'number',
                        isNullable: true,
                      },
                    },
                  }],
                }, {
                  type: 'null',
                }],
              },
              autoMaterialize: {
                type: 'any',
                isNullable: true,
              },
            },
          },
          isRequired: true,
        },
        assetToWorkflow: {
          type: 'array',
          contains: {
            properties: {
              assetId: {
                type: 'string',
                isRequired: true,
              },
              normalizedAssetId: {
                type: 'string',
                isRequired: true,
              },
              workflowId: {
                type: 'string',
                isRequired: true,
              },
              stepId: {
                type: 'string',
                isNullable: true,
              },
              reason: {
                type: 'Enum',
                isRequired: true,
              },
              priority: {
                type: 'number',
                isNullable: true,
              },
            },
          },
          isRequired: true,
        },
        eventSourceToTrigger: {
          type: 'array',
          contains: {
            properties: {
              sourceId: {
                type: 'string',
                isRequired: true,
              },
              triggerId: {
                type: 'string',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        stepToEventSource: {
          type: 'array',
          contains: {
            properties: {
              workflowId: {
                type: 'string',
                isRequired: true,
              },
              stepId: {
                type: 'string',
                isRequired: true,
              },
              sourceId: {
                type: 'string',
                isRequired: true,
              },
              kind: {
                type: 'Enum',
                isRequired: true,
              },
              confidence: {
                properties: {
                  sampleCount: {
                    type: 'number',
                    isRequired: true,
                  },
                  lastSeenAt: {
                    type: 'string',
                    isRequired: true,
                    format: 'date-time',
                  },
                },
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
