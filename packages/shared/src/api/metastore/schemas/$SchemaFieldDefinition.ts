/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $SchemaFieldDefinition = {
  properties: {
    path: {
      type: 'string',
      isRequired: true,
    },
    type: {
      type: 'string',
      isRequired: true,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    required: {
      type: 'boolean',
    },
    repeated: {
      type: 'boolean',
    },
    constraints: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
    },
    hints: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
    },
    examples: {
      type: 'array',
      contains: {
        properties: {
        },
      },
    },
    metadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
    },
  },
} as const;
