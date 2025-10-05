/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_30 = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount containing the source node.`,
      isRequired: true,
    },
    path: {
      type: 'string',
      description: `Source node path.`,
      isRequired: true,
    },
    targetPath: {
      type: 'string',
      description: `Destination path for the node.`,
      isRequired: true,
    },
    targetBackendMountId: {
      type: 'number',
      description: `Alternate backend mount for cross-mount moves.`,
    },
    overwrite: {
      type: 'boolean',
      description: `When true, replace an existing node at the destination.`,
    },
    idempotencyKey: {
      type: 'string',
      description: `Optional idempotency key.`,
    },
  },
} as const;
