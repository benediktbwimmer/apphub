/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $MetastoreAuditDiff = {
  properties: {
    audit: {
      properties: {
        id: {
          type: 'number',
          isRequired: true,
        },
        namespace: {
          type: 'string',
          isRequired: true,
        },
        key: {
          type: 'string',
          isRequired: true,
        },
        action: {
          type: 'string',
          isRequired: true,
        },
        actor: {
          type: 'string',
          isNullable: true,
        },
        previousVersion: {
          type: 'number',
          isNullable: true,
        },
        version: {
          type: 'number',
          isNullable: true,
        },
        createdAt: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
      },
      isRequired: true,
    },
    metadata: {
      properties: {
        added: {
          type: 'array',
          contains: {
            properties: {
              path: {
                type: 'string',
                isRequired: true,
              },
              value: {
                properties: {
                },
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        removed: {
          type: 'array',
          contains: {
            properties: {
              path: {
                type: 'string',
                isRequired: true,
              },
              value: {
                properties: {
                },
                isRequired: true,
              },
            },
          },
          isRequired: true,
        },
        changed: {
          type: 'array',
          contains: {
            properties: {
              path: {
                type: 'string',
                isRequired: true,
              },
              before: {
                properties: {
                },
                isRequired: true,
              },
              after: {
                properties: {
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
    tags: {
      properties: {
        added: {
          type: 'array',
          contains: {
            type: 'string',
          },
          isRequired: true,
        },
        removed: {
          type: 'array',
          contains: {
            type: 'string',
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
    owner: {
      properties: {
        before: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        after: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        changed: {
          type: 'boolean',
          isRequired: true,
        },
      },
      isRequired: true,
    },
    schemaHash: {
      properties: {
        before: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        after: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        changed: {
          type: 'boolean',
          isRequired: true,
        },
      },
      isRequired: true,
    },
    snapshots: {
      properties: {
        current: {
          type: 'MetastoreAuditSnapshot',
          isRequired: true,
        },
        previous: {
          type: 'MetastoreAuditSnapshot',
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
