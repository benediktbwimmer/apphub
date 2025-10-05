/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $SchemaDefinition = {
  type: 'all-of',
  contains: [{
    type: 'SchemaDefinitionInput',
  }, {
    properties: {
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
  }],
} as const;
