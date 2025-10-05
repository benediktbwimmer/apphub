/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ReconciliationJobListFilters = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend mount filter applied to the query.`,
      isRequired: true,
      isNullable: true,
    },
    path: {
      type: 'string',
      description: `Path filter applied to the job listing.`,
      isRequired: true,
      isNullable: true,
    },
    status: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
  },
} as const;
