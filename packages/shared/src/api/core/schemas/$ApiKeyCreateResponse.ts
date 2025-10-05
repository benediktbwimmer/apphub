/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ApiKeyCreateResponse = {
  properties: {
    data: {
      properties: {
        key: {
          type: 'def_73',
          isRequired: true,
        },
        token: {
          type: 'string',
          description: `Full API key token. This value is only returned once at creation time.`,
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
