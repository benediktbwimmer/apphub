/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $NodeRollup = {
  properties: {
    nodeId: {
      type: 'number',
      description: `Identifier of the node associated with this rollup.`,
      isRequired: true,
    },
    sizeBytes: {
      type: 'number',
      description: `Total bytes attributed to the subtree.`,
      isRequired: true,
    },
    fileCount: {
      type: 'number',
      description: `Number of files in the subtree.`,
      isRequired: true,
    },
    directoryCount: {
      type: 'number',
      description: `Number of directories in the subtree.`,
      isRequired: true,
    },
    childCount: {
      type: 'number',
      description: `Total direct children tracked in the rollup.`,
      isRequired: true,
    },
    state: {
      type: 'Enum',
      isRequired: true,
    },
    lastCalculatedAt: {
      type: 'string',
      description: `Timestamp of the most recent rollup calculation.`,
      isRequired: true,
      isNullable: true,
      format: 'date-time',
    },
  },
} as const;
