/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_74 = {
  properties: {
    data: {
      properties: {
        assetId: {
          type: 'string',
          isRequired: true,
        },
        stepId: {
          type: 'string',
          isRequired: true,
        },
        autoMaterialize: {
          type: 'any-of',
          contains: [{
            type: 'all-of',
            contains: [{
              properties: {
                enabled: {
                  type: 'boolean',
                },
                onUpstreamUpdate: {
                  type: 'boolean',
                },
                priority: {
                  type: 'number',
                  isNullable: true,
                },
                parameterDefaults: {
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
            }],
          }, {
            type: 'null',
          }],
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
