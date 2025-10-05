/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_33 = {
  description: `Structured metadata describing how a service is sourced, linked, and executed.`,
  properties: {
    resourceType: {
      type: 'Enum',
    },
    manifest: {
      type: 'any-of',
      contains: [{
        type: 'all-of',
        contains: [{
          type: 'def_31',
        }],
      }, {
        type: 'null',
      }],
    },
    config: {
      type: 'any-of',
      contains: [{
        type: 'all-of',
        description: `Raw metadata block forwarded from manifests or config files.`,
        contains: [{
          type: 'any-of',
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
          }, {
            type: 'null',
          }],
        }],
      }, {
        type: 'null',
      }],
    },
    runtime: {
      type: 'any-of',
      contains: [{
        type: 'all-of',
        contains: [{
          type: 'def_32',
        }],
      }, {
        type: 'null',
      }],
    },
    linkedApps: {
      type: 'any[]',
      description: `Explicit list of app IDs linked to this service beyond manifest hints.`,
      isNullable: true,
    },
    notes: {
      type: 'string',
      isNullable: true,
      maxLength: 2000,
    },
  },
} as const;
