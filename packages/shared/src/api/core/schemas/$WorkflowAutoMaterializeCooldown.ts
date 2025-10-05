/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $WorkflowAutoMaterializeCooldown = {
  properties: {
    failures: {
      type: 'number',
      isRequired: true,
    },
    nextEligibleAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
  },
} as const;
