/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_16 = {
  properties: {
    data: {
      type: 'array',
      contains: {
        properties: {
          id: {
            type: 'string',
            description: `Saved search identifier.`,
            isRequired: true,
          },
          slug: {
            type: 'string',
            description: `Shareable slug referencing the saved search.`,
            isRequired: true,
          },
          name: {
            type: 'string',
            description: `Human friendly label for the saved query.`,
            isRequired: true,
          },
          description: {
            type: 'string',
            isNullable: true,
          },
          searchInput: {
            type: 'string',
            description: `Raw core search input as entered by the operator.`,
            isRequired: true,
          },
          statusFilters: {
            type: 'array',
            contains: {
              type: 'Enum',
            },
            isRequired: true,
          },
          sort: {
            type: 'Enum',
            isRequired: true,
          },
          visibility: {
            type: 'Enum',
            isRequired: true,
          },
          appliedCount: {
            type: 'number',
            description: `Number of times the saved search has been applied.`,
            isRequired: true,
          },
          sharedCount: {
            type: 'number',
            description: `Number of share actions recorded for the saved search.`,
            isRequired: true,
          },
          lastAppliedAt: {
            type: 'string',
            isNullable: true,
            format: 'date-time',
          },
          lastSharedAt: {
            type: 'string',
            isNullable: true,
            format: 'date-time',
          },
          createdAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
        },
      },
      isRequired: true,
    },
  },
} as const;
