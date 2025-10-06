/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $WorkflowAutoMaterializeAssetUpdateRequest = {
  type: 'all-of',
  contains: [{
    properties: {
      stepId: {
        type: 'string',
        isRequired: true,
        maxLength: 200,
        minLength: 1,
      },
      enabled: {
        type: 'boolean',
      },
      onUpstreamUpdate: {
        type: 'boolean',
      },
      priority: {
        type: 'number',
        isNullable: true,
        maximum: 1000000,
      },
      parameterDefaults: {
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
    },
  }],
} as const;
