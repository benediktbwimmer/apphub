/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ServiceMetadata = {
  description: `Structured metadata describing how a service is sourced, linked, and executed.`,
  properties: {
    resourceType: {
      type: 'Enum',
    },
    manifest: {
      type: 'all-of',
      contains: [{
        type: 'def_31',
      }],
      isNullable: true,
    },
    config: {
      type: 'all-of',
      description: `Raw metadata block forwarded from manifests or config files.`,
      contains: [{
        type: 'any-of',
        description: `Arbitrary JSON value.`,
        contains: [{
          type: 'string',
        }, {
          type: 'number',
        }, {
          type: 'number',
        }, {
          type: 'boolean',
        }, {
          type: 'dictionary',
          contains: {
            properties: {
            },
          },
        }],
        isNullable: true,
      }],
      isNullable: true,
    },
    runtime: {
      type: 'all-of',
      contains: [{
        type: 'def_32',
      }],
      isNullable: true,
    },
    linkedApps: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isNullable: true,
    },
    notes: {
      type: 'string',
      isNullable: true,
      maxLength: 2000,
    },
  },
} as const;
