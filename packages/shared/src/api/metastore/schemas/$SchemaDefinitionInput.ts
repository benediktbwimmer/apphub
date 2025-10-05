/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $SchemaDefinitionInput = {
  properties: {
    schemaHash: {
      type: 'string',
      isRequired: true,
    },
    name: {
      type: 'string',
      isNullable: true,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    version: {
      type: 'one-of',
      contains: [{
        type: 'string',
      }, {
        type: 'number',
      }],
      isNullable: true,
    },
    metadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    fields: {
      type: 'array',
      contains: {
        type: 'SchemaFieldDefinition',
      },
      isRequired: true,
    },
  },
} as const;
