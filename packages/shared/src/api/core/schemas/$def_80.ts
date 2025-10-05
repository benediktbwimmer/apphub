/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_80 = {
  properties: {
    assetId: {
      type: 'string',
      isRequired: true,
    },
    normalizedAssetId: {
      type: 'string',
      isRequired: true,
    },
    producers: {
      type: 'array',
      contains: {
        properties: {
          workflowId: {
            type: 'string',
            isRequired: true,
          },
          workflowSlug: {
            type: 'string',
            isRequired: true,
          },
          workflowName: {
            type: 'string',
            isRequired: true,
          },
          stepId: {
            type: 'string',
            isRequired: true,
          },
          stepName: {
            type: 'string',
            isRequired: true,
          },
          stepType: {
            type: 'Enum',
            isRequired: true,
          },
          partitioning: {
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
          autoMaterialize: {
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
          freshness: {
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
        },
      },
      isRequired: true,
    },
    consumers: {
      type: 'array',
      contains: {
        properties: {
          workflowId: {
            type: 'string',
            isRequired: true,
          },
          workflowSlug: {
            type: 'string',
            isRequired: true,
          },
          workflowName: {
            type: 'string',
            isRequired: true,
          },
          stepId: {
            type: 'string',
            isRequired: true,
          },
          stepName: {
            type: 'string',
            isRequired: true,
          },
          stepType: {
            type: 'Enum',
            isRequired: true,
          },
        },
      },
      isRequired: true,
    },
    latestMaterializations: {
      type: 'array',
      contains: {
        properties: {
          workflowId: {
            type: 'string',
            isRequired: true,
          },
          workflowSlug: {
            type: 'string',
            isRequired: true,
          },
          workflowName: {
            type: 'string',
            isRequired: true,
          },
          runId: {
            type: 'string',
            isRequired: true,
          },
          stepId: {
            type: 'string',
            isRequired: true,
          },
          stepName: {
            type: 'string',
            isRequired: true,
          },
          stepType: {
            type: 'Enum',
            isRequired: true,
          },
          runStatus: {
            type: 'Enum',
            isRequired: true,
          },
          stepStatus: {
            type: 'Enum',
            isRequired: true,
          },
          producedAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          partitionKey: {
            type: 'string',
            isRequired: true,
            isNullable: true,
          },
          freshness: {
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
          runStartedAt: {
            type: 'string',
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          runCompletedAt: {
            type: 'string',
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
        },
      },
      isRequired: true,
    },
    stalePartitions: {
      type: 'array',
      contains: {
        properties: {
          workflowId: {
            type: 'string',
            isRequired: true,
          },
          workflowSlug: {
            type: 'string',
            isRequired: true,
          },
          workflowName: {
            type: 'string',
            isRequired: true,
          },
          partitionKey: {
            type: 'string',
            isRequired: true,
            isNullable: true,
          },
          requestedAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          requestedBy: {
            type: 'string',
            isRequired: true,
            isNullable: true,
          },
          note: {
            type: 'string',
            isRequired: true,
            isNullable: true,
          },
        },
      },
      isRequired: true,
    },
    hasStalePartitions: {
      type: 'boolean',
      isRequired: true,
    },
    hasOutdatedUpstreams: {
      type: 'boolean',
      isRequired: true,
    },
    outdatedUpstreamAssetIds: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
  },
} as const;
