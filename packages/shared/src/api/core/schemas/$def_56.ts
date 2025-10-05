/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_56 = {
  properties: {
    entryPoint: {
      type: 'string',
      isRequired: true,
      maxLength: 256,
      minLength: 1,
    },
    manifestPath: {
      type: 'string',
      isRequired: true,
      maxLength: 512,
      minLength: 1,
    },
    manifest: {
      type: 'def_0',
    },
    files: {
      type: 'array',
      contains: {
        properties: {
          path: {
            type: 'string',
            isRequired: true,
            maxLength: 512,
            minLength: 1,
          },
          contents: {
            type: 'string',
            isRequired: true,
          },
          encoding: {
            type: 'Enum',
          },
          executable: {
            type: 'boolean',
          },
        },
      },
      isRequired: true,
    },
    capabilityFlags: {
      type: 'array',
      contains: {
        type: 'string',
        minLength: 1,
      },
    },
    metadata: {
      type: 'def_0',
    },
    description: {
      type: 'string',
      isNullable: true,
      maxLength: 512,
    },
    displayName: {
      type: 'string',
      isNullable: true,
      maxLength: 256,
    },
    version: {
      type: 'string',
      maxLength: 100,
    },
  },
} as const;
