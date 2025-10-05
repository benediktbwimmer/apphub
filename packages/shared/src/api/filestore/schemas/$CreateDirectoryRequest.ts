/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $CreateDirectoryRequest = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount receiving the directory.`,
      isRequired: true,
    },
    path: {
      type: 'string',
      description: `Directory path to create.`,
      isRequired: true,
    },
    metadata: {
      type: 'dictionary',
      contains: {
        type: 'def_0',
      },
    },
    idempotencyKey: {
      type: 'string',
      description: `Optional idempotency key to reuse previous results.`,
    },
  },
} as const;
