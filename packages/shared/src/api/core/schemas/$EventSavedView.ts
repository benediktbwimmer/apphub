/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $EventSavedView = {
  properties: {
    id: {
      type: 'string',
      description: `Saved view identifier.`,
      isRequired: true,
    },
    slug: {
      type: 'string',
      description: `Slug used to reference the saved view.`,
      isRequired: true,
    },
    name: {
      type: 'string',
      description: `Display name for the saved view.`,
      isRequired: true,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    filters: {
      properties: {
        type: {
          type: 'string',
          maxLength: 200,
        },
        source: {
          type: 'string',
          maxLength: 200,
        },
        correlationId: {
          type: 'string',
          maxLength: 200,
        },
        from: {
          type: 'string',
          format: 'date-time',
        },
        to: {
          type: 'string',
          format: 'date-time',
        },
        jsonPath: {
          type: 'string',
          maxLength: 500,
        },
        severity: {
          type: 'array',
          contains: {
            type: 'Enum',
          },
        },
        limit: {
          type: 'number',
          maximum: 200,
          minimum: 1,
        },
      },
      isRequired: true,
    },
    visibility: {
      type: 'Enum',
      isRequired: true,
    },
    appliedCount: {
      type: 'number',
      isRequired: true,
    },
    sharedCount: {
      type: 'number',
      isRequired: true,
    },
    lastAppliedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    lastSharedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
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
    owner: {
      properties: {
        key: {
          type: 'string',
          isRequired: true,
        },
        subject: {
          type: 'string',
          isRequired: true,
        },
        kind: {
          type: 'Enum',
          isRequired: true,
        },
        userId: {
          type: 'string',
          isNullable: true,
        },
      },
      isRequired: true,
    },
    analytics: {
      properties: {
        windowSeconds: {
          type: 'number',
          isRequired: true,
          minimum: 60,
        },
        totalEvents: {
          type: 'number',
          isRequired: true,
        },
        errorEvents: {
          type: 'number',
          isRequired: true,
        },
        eventRatePerMinute: {
          type: 'number',
          isRequired: true,
        },
        errorRatio: {
          type: 'number',
          isRequired: true,
        },
        generatedAt: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
        sampledCount: {
          type: 'number',
          isRequired: true,
        },
        sampleLimit: {
          type: 'number',
          isRequired: true,
          minimum: 1,
        },
        truncated: {
          type: 'boolean',
          isRequired: true,
        },
      },
      isNullable: true,
    },
  },
} as const;
