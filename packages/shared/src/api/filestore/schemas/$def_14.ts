/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_14 = {
  properties: {
    mountKey: {
      type: 'string',
      description: `Updated slug for the backend mount.`,
    },
    displayName: {
      type: 'string',
      description: `Optional display name.`,
      isNullable: true,
    },
    description: {
      type: 'string',
      description: `Optional description.`,
      isNullable: true,
    },
    contact: {
      type: 'string',
      description: `Point of contact for the backend.`,
      isNullable: true,
    },
    labels: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    state: {
      type: 'Enum',
    },
    stateReason: {
      type: 'string',
      description: `Explanation for the assigned state.`,
      isNullable: true,
    },
    accessMode: {
      type: 'Enum',
    },
    rootPath: {
      type: 'string',
      description: `Path to mount for local backends.`,
      isNullable: true,
    },
    bucket: {
      type: 'string',
      description: `Bucket name for S3 backends.`,
      isNullable: true,
    },
    prefix: {
      type: 'string',
      description: `Optional path prefix when interacting with the backend.`,
      isNullable: true,
    },
    config: {
      type: 'any',
      description: `Backend specific configuration overrides.`,
      isNullable: true,
    },
  },
} as const;
