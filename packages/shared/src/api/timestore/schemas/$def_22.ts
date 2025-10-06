/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_22 = {
  properties: {
    mode: {
      type: 'Enum',
      isRequired: true,
    },
    manifest: {
      type: 'any',
      isNullable: true,
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
    flushPending: {
      type: 'boolean',
      isRequired: true,
    },
  },
} as const;
