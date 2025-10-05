/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $AssetGraphProducer = {
  properties: {
    workflowId: {
      type: 'string',
      isRequired: true,
    },
    workflowSlug: {
      type: 'string',
      isRequired: true,
    },
    workflowName: {
      type: 'string',
      isRequired: true,
    },
    stepId: {
      type: 'string',
      isRequired: true,
    },
    stepName: {
      type: 'string',
      isRequired: true,
    },
    stepType: {
      type: 'Enum',
      isRequired: true,
    },
    partitioning: {
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
      isRequired: true,
      isNullable: true,
    },
    autoMaterialize: {
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
      isRequired: true,
      isNullable: true,
    },
    freshness: {
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
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
