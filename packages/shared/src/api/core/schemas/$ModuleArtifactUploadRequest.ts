/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ModuleArtifactUploadRequest = {
  properties: {
    moduleId: {
      type: 'string',
      isRequired: true,
      minLength: 1,
    },
    moduleVersion: {
      type: 'string',
      isRequired: true,
      minLength: 1,
    },
    displayName: {
      type: 'string',
      isNullable: true,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    keywords: {
      type: 'array',
      contains: {
        type: 'string',
        minLength: 1,
      },
    },
    manifest: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isRequired: true,
    },
    artifact: {
      properties: {
        filename: {
          type: 'string',
          minLength: 1,
        },
        contentType: {
          type: 'string',
          minLength: 1,
        },
        data: {
          type: 'string',
          description: `Base64-encoded module bundle contents.`,
          isRequired: true,
          minLength: 1,
        },
      },
      isRequired: true,
    },
  },
} as const;
