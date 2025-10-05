/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $LaunchEnvVar = {
  properties: {
    key: {
      type: 'string',
      description: `Environment variable name.`,
      isRequired: true,
    },
    value: {
      type: 'string',
      description: `Environment variable value.`,
      isRequired: true,
    },
  },
} as const;
