/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_18 = {
  properties: {
    mode: {
      type: 'Enum',
      isRequired: true,
    },
    manifest: {
      properties: {
        id: {
          type: 'string',
          isRequired: true,
        },
        datasetId: {
          type: 'string',
          isRequired: true,
        },
        version: {
          type: 'number',
          isRequired: true,
        },
        status: {
          type: 'Enum',
          isRequired: true,
        },
        schemaVersionId: {
          type: 'string',
          isNullable: true,
        },
        parentManifestId: {
          type: 'string',
          isNullable: true,
        },
        manifestShard: {
          type: 'string',
          isRequired: true,
        },
        summary: {
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
          isRequired: true,
        },
        statistics: {
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
          isRequired: true,
        },
        metadata: {
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
          isRequired: true,
        },
        partitionCount: {
          type: 'number',
          isRequired: true,
        },
        totalRows: {
          type: 'number',
          isRequired: true,
        },
        totalBytes: {
          type: 'number',
          isRequired: true,
        },
        createdBy: {
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
        publishedAt: {
          type: 'string',
          isNullable: true,
          format: 'date-time',
        },
        partitions: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              datasetId: {
                type: 'string',
                isRequired: true,
              },
              manifestId: {
                type: 'string',
                isRequired: true,
              },
              manifestShard: {
                type: 'string',
              },
              partitionKey: {
                type: 'dictionary',
                contains: {
                  type: 'def_0',
                },
                isRequired: true,
              },
              storageTargetId: {
                type: 'string',
                isRequired: true,
              },
              fileFormat: {
                type: 'Enum',
                isRequired: true,
              },
              filePath: {
                type: 'string',
                isRequired: true,
              },
              fileSizeBytes: {
                type: 'number',
                isNullable: true,
              },
              rowCount: {
                type: 'number',
                isNullable: true,
              },
              startTime: {
                type: 'string',
                isRequired: true,
                format: 'date-time',
              },
              endTime: {
                type: 'string',
                isRequired: true,
                format: 'date-time',
              },
              checksum: {
                type: 'string',
                isNullable: true,
              },
              metadata: {
                type: 'dictionary',
                contains: {
                  type: 'def_0',
                },
                isRequired: true,
              },
              columnStatistics: {
                type: 'dictionary',
                contains: {
                  type: 'def_0',
                },
                isRequired: true,
              },
              columnBloomFilters: {
                type: 'dictionary',
                contains: {
                  type: 'def_0',
                },
                isRequired: true,
              },
              ingestionSignature: {
                type: 'string',
                isNullable: true,
              },
              createdAt: {
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
    dataset: {
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
        description: {
          type: 'string',
          isNullable: true,
        },
        status: {
          type: 'Enum',
          isRequired: true,
        },
        writeFormat: {
          type: 'Enum',
          isRequired: true,
        },
        defaultStorageTargetId: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        metadata: {
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
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
      isRequired: true,
    },
    storageTarget: {
      properties: {
        id: {
          type: 'string',
          isRequired: true,
        },
        name: {
          type: 'string',
          isRequired: true,
        },
        kind: {
          type: 'Enum',
          isRequired: true,
        },
        description: {
          type: 'string',
          isNullable: true,
        },
        config: {
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
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
      isRequired: true,
    },
  },
} as const;
