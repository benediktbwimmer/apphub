/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_28 = {
  properties: {
    id: {
      type: 'string',
      description: `Lowercase identifier for the app (letters, numbers, and dashes).`,
      isRequired: true,
      maxLength: 64,
      minLength: 3,
      pattern: '^[a-z][a-z0-9-]{2,63}$',
    },
    name: {
      type: 'string',
      description: `Human readable name for the app.`,
      isRequired: true,
    },
    description: {
      type: 'string',
      description: `Short description that appears in the core.`,
      isRequired: true,
    },
    repoUrl: {
      type: 'string',
      description: `Location of the repository. Supports git, HTTP(S), and absolute filesystem paths.`,
      isRequired: true,
    },
    dockerfilePath: {
      type: 'string',
      description: `Repository-relative path to the Dockerfile (e.g. services/api/Dockerfile).`,
      isRequired: true,
      pattern: 'Dockerfile(.[^/]+)?$',
    },
    tags: {
      type: 'array',
      contains: {
        properties: {
          key: {
            type: 'string',
            description: `Tag key.`,
            isRequired: true,
          },
          value: {
            type: 'string',
            description: `Tag value.`,
            isRequired: true,
          },
        },
      },
    },
  },
} as const;
