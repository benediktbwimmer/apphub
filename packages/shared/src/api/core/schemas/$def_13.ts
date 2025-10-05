/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_13 = {
  properties: {
    data: {
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
          type: 'any-of',
          contains: [{
            type: 'all-of',
            contains: [{
              type: 'def_6',
            }],
          }, {
            type: 'null',
          }],
        },
        latestLaunch: {
          type: 'any-of',
          contains: [{
            type: 'all-of',
            contains: [{
              type: 'def_7',
            }],
          }, {
            type: 'null',
          }],
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
          type: 'any-of',
          contains: [{
            type: 'all-of',
            contains: [{
              type: 'def_10',
            }],
          }, {
            type: 'null',
          }],
        },
      },
      isRequired: true,
    },
  },
} as const;
