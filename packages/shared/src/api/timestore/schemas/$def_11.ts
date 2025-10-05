/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_11 = {
  properties: {
    status: {
      type: 'Enum',
      isRequired: true,
    },
    reason: {
      type: 'string',
      description: `Detailed reason describing why the service is not ready.`,
      isRequired: true,
    },
    lifecycle: {
      properties: {
        inline: {
          type: 'boolean',
          description: `Indicates whether queue processing runs inline instead of Redis-backed.`,
          isRequired: true,
        },
        ready: {
          type: 'boolean',
          description: `True when the lifecycle queue connection is available.`,
          isRequired: true,
        },
        lastError: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
      },
      isRequired: true,
    },
    features: {
      properties: {
        streaming: {
          properties: {
            enabled: {
              type: 'boolean',
              isRequired: true,
            },
            state: {
              type: 'Enum',
              isRequired: true,
            },
            reason: {
              type: 'string',
              isRequired: true,
              isNullable: true,
            },
            broker: {
              properties: {
                configured: {
                  type: 'boolean',
                  isRequired: true,
                },
                reachable: {
                  type: 'boolean',
                  isRequired: true,
                  isNullable: true,
                },
                lastCheckedAt: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                  format: 'date-time',
                },
                error: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
              },
              isRequired: true,
            },
            batchers: {
              properties: {
                configured: {
                  type: 'number',
                  isRequired: true,
                },
                running: {
                  type: 'number',
                  isRequired: true,
                },
                failing: {
                  type: 'number',
                  isRequired: true,
                },
                state: {
                  type: 'Enum',
                  isRequired: true,
                },
                connectors: {
                  type: 'array',
                  contains: {
                    properties: {
                      connectorId: {
                        type: 'string',
                        isRequired: true,
                      },
                      datasetSlug: {
                        type: 'string',
                        isRequired: true,
                      },
                      topic: {
                        type: 'string',
                        isRequired: true,
                      },
                      groupId: {
                        type: 'string',
                        isRequired: true,
                      },
                      state: {
                        type: 'Enum',
                        isRequired: true,
                      },
                      bufferedWindows: {
                        type: 'number',
                        isRequired: true,
                      },
                      bufferedRows: {
                        type: 'number',
                        isRequired: true,
                      },
                      openWindows: {
                        type: 'number',
                        isRequired: true,
                      },
                      lastMessageAt: {
                        type: 'string',
                        isRequired: true,
                        isNullable: true,
                        format: 'date-time',
                      },
                      lastFlushAt: {
                        type: 'string',
                        isRequired: true,
                        isNullable: true,
                        format: 'date-time',
                      },
                      lastEventTimestamp: {
                        type: 'string',
                        isRequired: true,
                        isNullable: true,
                        format: 'date-time',
                      },
                      lastError: {
                        type: 'string',
                        isRequired: true,
                        isNullable: true,
                      },
                    },
                  },
                  isRequired: true,
                },
              },
              isRequired: true,
            },
            hotBuffer: {
              type: 'all-of',
              contains: [{
                properties: {
                  enabled: {
                    type: 'boolean',
                    isRequired: true,
                  },
                  state: {
                    type: 'Enum',
                    isRequired: true,
                  },
                  datasets: {
                    type: 'number',
                    isRequired: true,
                  },
                  healthy: {
                    type: 'boolean',
                    isRequired: true,
                  },
                  lastRefreshAt: {
                    type: 'string',
                    isRequired: true,
                    isNullable: true,
                    format: 'date-time',
                  },
                  lastIngestAt: {
                    type: 'string',
                    isRequired: true,
                    isNullable: true,
                    format: 'date-time',
                  },
                },
              }],
              isRequired: true,
            },
            mirrors: {
              type: 'dictionary',
              contains: {
                type: 'boolean',
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
