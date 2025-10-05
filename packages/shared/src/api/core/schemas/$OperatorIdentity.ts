/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $OperatorIdentity = {
  properties: {
    subject: {
      type: 'string',
      description: `Identifier for the authenticated principal (user email, service name, or token subject).`,
      isRequired: true,
    },
    kind: {
      type: 'Enum',
      isRequired: true,
    },
    scopes: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    userId: {
      type: 'string',
      isNullable: true,
    },
    sessionId: {
      type: 'string',
      isNullable: true,
    },
    apiKeyId: {
      type: 'string',
      isNullable: true,
    },
    authDisabled: {
      type: 'boolean',
      description: `Indicates that the server is running with authentication disabled for local development.`,
    },
    displayName: {
      type: 'string',
      isNullable: true,
    },
    email: {
      type: 'string',
      isNullable: true,
    },
    roles: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
  },
} as const;
