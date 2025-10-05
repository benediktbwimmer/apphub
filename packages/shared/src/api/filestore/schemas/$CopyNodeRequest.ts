/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $CopyNodeRequest = {
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
      description: `Destination path for the copy.`,
      isRequired: true,
    },
    targetBackendMountId: {
      type: 'number',
      description: `Alternate backend mount for cross-mount copies.`,
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
