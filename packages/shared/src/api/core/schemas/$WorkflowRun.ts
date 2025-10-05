/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $WorkflowRun = {
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
      isNullable: true,
    },
    context: {
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
      isNullable: true,
    },
    output: {
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
      isNullable: true,
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
      isNullable: true,
    },
    triggeredBy: {
      type: 'string',
      isNullable: true,
    },
    trigger: {
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
      isNullable: true,
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
