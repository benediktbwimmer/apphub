/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_13 = {
  properties: {
    datasetName: {
      type: 'string',
      description: `Display name to assign if the dataset is created automatically.`,
      isNullable: true,
    },
    storageTargetId: {
      type: 'string',
      description: `Explicit storage target identifier. Defaults to the dataset's configured target.`,
      isNullable: true,
    },
    tableName: {
      type: 'string',
      description: `Physical table name override for the dataset backend.`,
      isNullable: true,
    },
    schema: {
      properties: {
        fields: {
          type: 'array',
          contains: {
            properties: {
              name: {
                type: 'string',
                description: `Logical column name defined by the dataset schema.`,
                isRequired: true,
              },
              type: {
                type: 'Enum',
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        evolution: {
          properties: {
            defaults: {
              type: 'any',
              isNullable: true,
            },
            backfill: {
              type: 'boolean',
              isNullable: true,
            },
          },
        },
      },
      isRequired: true,
    },
    partition: {
      properties: {
        key: {
          type: 'dictionary',
          contains: {
            type: 'string',
          },
          isRequired: true,
        },
        attributes: {
          type: 'any',
          description: `Optional attributes describing the partition.`,
          isNullable: true,
        },
        timeRange: {
          properties: {
            start: {
              type: 'string',
              isRequired: true,
              format: 'date-time',
            },
            end: {
              type: 'string',
              isRequired: true,
              format: 'date-time',
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
    rows: {
      type: 'array',
      contains: {
        type: 'dictionary',
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
      isRequired: true,
    },
    idempotencyKey: {
      type: 'string',
      description: `Client supplied token to deduplicate ingestion attempts.`,
      isNullable: true,
      maxLength: 255,
    },
    actor: {
      type: 'any',
      isNullable: true,
    },
  },
} as const;
