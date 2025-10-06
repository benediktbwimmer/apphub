/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_80 = {
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
      isRequired: true,
    },
    autoMaterialize: {
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
      isRequired: true,
    },
    freshness: {
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
      isRequired: true,
    },
  },
} as const;
