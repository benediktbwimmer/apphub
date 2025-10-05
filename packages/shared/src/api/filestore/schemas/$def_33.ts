/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_33 = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount containing the node to reconcile.`,
      isRequired: true,
    },
    path: {
      type: 'string',
      description: `Path of the node to reconcile.`,
      isRequired: true,
    },
    nodeId: {
      type: 'number',
      description: `Identifier of the node to reconcile.`,
      isNullable: true,
    },
    reason: {
      type: 'Enum',
    },
    detectChildren: {
      type: 'boolean',
      description: `When true, enqueue reconciliation jobs for child nodes.`,
    },
    requestedHash: {
      type: 'boolean',
      description: `When true, force hash recomputation for the node.`,
    },
  },
} as const;
