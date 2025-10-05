/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_17 = {
  properties: {
    mode: {
      type: 'Enum',
      isRequired: true,
    },
    streamUrl: {
      type: 'string',
      description: `URL to stream the file through the filestore service.`,
      isRequired: true,
    },
    presignUrl: {
      type: 'string',
      description: `Link to request a presigned download if supported.`,
      isRequired: true,
      isNullable: true,
    },
    supportsRange: {
      type: 'boolean',
      description: `Indicates whether byte-range requests are supported.`,
      isRequired: true,
    },
    sizeBytes: {
      type: 'number',
      description: `Known size of the file when available.`,
      isRequired: true,
      isNullable: true,
    },
    checksum: {
      type: 'string',
      description: `Checksum recorded for the file content.`,
      isRequired: true,
      isNullable: true,
    },
    contentHash: {
      type: 'string',
      description: `Content hash recorded for the file content.`,
      isRequired: true,
      isNullable: true,
    },
    filename: {
      type: 'string',
      description: `Suggested filename for downloads.`,
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
