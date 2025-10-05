/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_32 = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount containing the node.`,
      isRequired: true,
    },
    set: {
      type: 'any',
      description: `Metadata entries to overwrite.`,
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
