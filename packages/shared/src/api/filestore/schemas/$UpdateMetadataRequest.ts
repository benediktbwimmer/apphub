/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $UpdateMetadataRequest = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount containing the node.`,
      isRequired: true,
    },
    set: {
      type: 'dictionary',
      contains: {
        type: 'def_0',
      },
      isNullable: true,
    },
    unset: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    idempotencyKey: {
      type: 'string',
      description: `Optional idempotency key.`,
    },
  },
} as const;
