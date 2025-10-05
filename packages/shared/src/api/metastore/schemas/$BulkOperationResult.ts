/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $BulkOperationResult = {
  type: 'one-of',
  contains: [{
    properties: {
      status: {
        type: 'Enum',
        isRequired: true,
      },
      type: {
        type: 'Enum',
        isRequired: true,
      },
      namespace: {
        type: 'string',
        isRequired: true,
      },
      key: {
        type: 'string',
        isRequired: true,
      },
      created: {
        type: 'boolean',
      },
      record: {
        type: 'MetastoreRecord',
        isRequired: true,
      },
    },
  }, {
    properties: {
      status: {
        type: 'Enum',
        isRequired: true,
      },
      namespace: {
        type: 'string',
        isRequired: true,
      },
      key: {
        type: 'string',
        isRequired: true,
      },
      error: {
        properties: {
          statusCode: {
            type: 'number',
            isRequired: true,
          },
          code: {
            type: 'string',
            isRequired: true,
          },
          message: {
            type: 'string',
            isRequired: true,
          },
        },
        isRequired: true,
      },
    },
  }],
} as const;
