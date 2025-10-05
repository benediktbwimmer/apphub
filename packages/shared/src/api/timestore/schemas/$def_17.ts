/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_17 = {
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
} as const;
