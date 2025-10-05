/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $Pagination = {
  properties: {
    total: {
      type: 'number',
      description: `Total matching records.`,
      isRequired: true,
    },
    limit: {
      type: 'number',
      description: `Requested page size.`,
      isRequired: true,
    },
    offset: {
      type: 'number',
      description: `Current offset within the collection.`,
      isRequired: true,
    },
    nextOffset: {
      type: 'number',
      description: `Next offset to request, if more data is available.`,
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
