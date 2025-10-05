/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $RepositoryListResponse = {
  properties: {
    data: {
      type: 'array',
      contains: {
        properties: {
          id: {
            type: 'string',
            description: `Repository identifier.`,
            isRequired: true,
          },
          name: {
            type: 'string',
            isRequired: true,
          },
          description: {
            type: 'string',
            isRequired: true,
          },
          repoUrl: {
            type: 'string',
            description: `Git or HTTP URL where the repository is hosted.`,
            isRequired: true,
          },
          dockerfilePath: {
            type: 'string',
            isRequired: true,
          },
          updatedAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          ingestStatus: {
            type: 'Enum',
            isRequired: true,
          },
          ingestError: {
            type: 'string',
            isNullable: true,
          },
          ingestAttempts: {
            type: 'number',
            isRequired: true,
          },
          latestBuild: {
            type: 'all-of',
            contains: [{
              type: 'def_6',
            }],
            isNullable: true,
          },
          latestLaunch: {
            type: 'all-of',
            contains: [{
              type: 'def_7',
            }],
            isNullable: true,
          },
          previewTiles: {
            type: 'array',
            contains: {
              properties: {
                id: {
                  type: 'string',
                  isRequired: true,
                },
                kind: {
                  type: 'string',
                  isRequired: true,
                },
                title: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
                description: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
                src: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
                embedUrl: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
                posterUrl: {
                  type: 'string',
                  isRequired: true,
                  isNullable: true,
                },
                width: {
                  type: 'number',
                  isRequired: true,
                  isNullable: true,
                },
                height: {
                  type: 'number',
                  isRequired: true,
                  isNullable: true,
                },
                sortOrder: {
                  type: 'number',
                  isRequired: true,
                },
                source: {
                  type: 'string',
                  isRequired: true,
                },
              },
            },
            isRequired: true,
          },
          tags: {
            type: 'array',
            contains: {
              properties: {
                key: {
                  type: 'string',
                  description: `Tag key.`,
                  isRequired: true,
                },
                value: {
                  type: 'string',
                  description: `Tag value.`,
                  isRequired: true,
                },
              },
            },
            isRequired: true,
          },
          launchEnvTemplates: {
            type: 'array',
            contains: {
              properties: {
                key: {
                  type: 'string',
                  description: `Environment variable name.`,
                  isRequired: true,
                },
                value: {
                  type: 'string',
                  description: `Environment variable value.`,
                  isRequired: true,
                },
              },
            },
            isRequired: true,
          },
          relevance: {
            type: 'all-of',
            contains: [{
              type: 'def_10',
            }],
            isNullable: true,
          },
        },
      },
      isRequired: true,
    },
    facets: {
      properties: {
        tags: {
          type: 'array',
          contains: {
            properties: {
              key: {
                type: 'string',
                isRequired: true,
              },
              value: {
                type: 'string',
                isRequired: true,
              },
              count: {
                type: 'number',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        statuses: {
          type: 'array',
          contains: {
            properties: {
              status: {
                type: 'Enum',
                isRequired: true,
              },
              count: {
                type: 'number',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        owners: {
          type: 'array',
          contains: {
            properties: {
              key: {
                type: 'string',
                isRequired: true,
              },
              value: {
                type: 'string',
                isRequired: true,
              },
              count: {
                type: 'number',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        frameworks: {
          type: 'array',
          contains: {
            properties: {
              key: {
                type: 'string',
                isRequired: true,
              },
              value: {
                type: 'string',
                isRequired: true,
              },
              count: {
                type: 'number',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
    total: {
      type: 'number',
      isRequired: true,
    },
    meta: {
      properties: {
        tokens: {
          type: 'array',
          contains: {
            type: 'string',
          },
          isRequired: true,
        },
        sort: {
          type: 'Enum',
          isRequired: true,
        },
        weights: {
          properties: {
            name: {
              type: 'number',
              isRequired: true,
            },
            description: {
              type: 'number',
              isRequired: true,
            },
            tags: {
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
