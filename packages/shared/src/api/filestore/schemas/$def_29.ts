/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_29 = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount containing the node.`,
      isRequired: true,
    },
    path: {
      type: 'string',
      description: `Path of the node to delete.`,
      isRequired: true,
    },
    recursive: {
      type: 'boolean',
      description: `When true, delete directories and their contents.`,
    },
    idempotencyKey: {
      type: 'string',
      description: `Optional idempotency key.`,
    },
  },
} as const;
