/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_69 = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    workflowDefinitionId: {
      type: 'string',
      isRequired: true,
    },
    status: {
      type: 'Enum',
      isRequired: true,
    },
    parameters: {
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
    context: {
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
    output: {
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
    errorMessage: {
      type: 'string',
      isNullable: true,
    },
    currentStepId: {
      type: 'string',
      isNullable: true,
    },
    currentStepIndex: {
      type: 'number',
      isNullable: true,
    },
    metrics: {
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
    triggeredBy: {
      type: 'string',
      isNullable: true,
    },
    trigger: {
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
    partitionKey: {
      type: 'string',
      isNullable: true,
    },
    startedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    completedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    durationMs: {
      type: 'number',
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
  },
} as const;
