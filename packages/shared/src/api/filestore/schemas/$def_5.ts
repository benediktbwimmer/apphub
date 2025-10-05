/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_5 = {
  properties: {
    status: {
      type: 'Enum',
      isRequired: true,
    },
    events: {
      properties: {
        mode: {
          type: 'Enum',
          isRequired: true,
        },
        ready: {
          type: 'boolean',
          description: `Indicates whether the event publisher is ready.`,
          isRequired: true,
        },
        lastError: {
          type: 'string',
          description: `Most recent connection or publish error, when available.`,
          isRequired: true,
          isNullable: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
