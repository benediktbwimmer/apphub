/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $JobBundleVersion = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    bundleId: {
      type: 'string',
      isRequired: true,
    },
    slug: {
      type: 'string',
      isRequired: true,
    },
    version: {
      type: 'string',
      isRequired: true,
    },
    checksum: {
      type: 'string',
      description: `SHA-256 checksum of the stored artifact.`,
      isRequired: true,
    },
    capabilityFlags: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    immutable: {
      type: 'boolean',
      description: `Indicates whether further edits to this version are allowed.`,
      isRequired: true,
    },
    status: {
      type: 'string',
      description: `Lifecycle status of the bundle version.`,
      isRequired: true,
    },
    artifact: {
      properties: {
        storage: {
          type: 'string',
          description: `Where the bundle artifact is stored.`,
          isRequired: true,
        },
        contentType: {
          type: 'string',
          description: `MIME type reported for the bundle artifact.`,
          isRequired: true,
        },
        size: {
          type: 'number',
          description: `Size of the bundle artifact in bytes.`,
          isRequired: true,
        },
      },
      isRequired: true,
    },
    manifest: {
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
    },
    metadata: {
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
      isRequired: true,
      isNullable: true,
    },
    publishedBy: {
      properties: {
        subject: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        kind: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
        tokenHash: {
          type: 'string',
          isRequired: true,
          isNullable: true,
        },
      },
      isNullable: true,
    },
    publishedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    deprecatedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    replacedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    replacedBy: {
      type: 'string',
      isNullable: true,
    },
    createdAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    download: {
      properties: {
        url: {
          type: 'string',
          isRequired: true,
          format: 'uri',
        },
        expiresAt: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
        storage: {
          type: 'string',
          isRequired: true,
        },
        kind: {
          type: 'string',
          isRequired: true,
        },
      },
    },
  },
} as const;
