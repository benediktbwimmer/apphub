/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $AssetGraphConsumer = {
  properties: {
    workflowId: {
      type: 'string',
      isRequired: true,
    },
    workflowSlug: {
      type: 'string',
      isRequired: true,
    },
    workflowName: {
      type: 'string',
      isRequired: true,
    },
    stepId: {
      type: 'string',
      isRequired: true,
    },
    stepName: {
      type: 'string',
      isRequired: true,
    },
    stepType: {
      type: 'Enum',
      isRequired: true,
    },
  },
} as const;
