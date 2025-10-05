/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_72 = {
  properties: {
    data: {
      properties: {
        runs: {
          type: 'array',
          contains: {
            type: 'def_69',
          },
          isRequired: true,
        },
        inFlight: {
          type: 'any-of',
          contains: [{
            type: 'all-of',
            contains: [{
              type: 'def_70',
            }],
          }, {
            type: 'null',
          }],
          isRequired: true,
        },
        cooldown: {
          type: 'any-of',
          contains: [{
            type: 'all-of',
            contains: [{
              type: 'def_71',
            }],
          }, {
            type: 'null',
          }],
          isRequired: true,
        },
        updatedAt: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
      },
      isRequired: true,
    },
    meta: {
      properties: {
        workflow: {
          properties: {
            id: {
              type: 'string',
              isRequired: true,
            },
            slug: {
              type: 'string',
              isRequired: true,
            },
            name: {
              type: 'string',
              isRequired: true,
            },
          },
        },
        limit: {
          type: 'number',
          maximum: 50,
          minimum: 1,
        },
        offset: {
          type: 'number',
        },
      },
    },
  },
} as const;
