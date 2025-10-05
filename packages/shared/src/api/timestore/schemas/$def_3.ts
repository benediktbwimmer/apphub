/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_3 = {
  properties: {
    inline: {
      type: 'boolean',
      description: `Indicates whether queue processing runs inline instead of Redis-backed.`,
      isRequired: true,
    },
    ready: {
      type: 'boolean',
      description: `True when the lifecycle queue connection is available.`,
      isRequired: true,
    },
    lastError: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
