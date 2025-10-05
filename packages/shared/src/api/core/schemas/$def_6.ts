/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_6 = {
  properties: {
    id: {
      type: 'string',
      description: `Unique build identifier.`,
      isRequired: true,
    },
    repositoryId: {
      type: 'string',
      description: `Identifier of the source repository.`,
      isRequired: true,
    },
    status: {
      type: 'Enum',
      isRequired: true,
    },
    imageTag: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
    errorMessage: {
      type: 'string',
      isNullable: true,
    },
    commitSha: {
      type: 'string',
      isNullable: true,
    },
    gitBranch: {
      type: 'string',
      isNullable: true,
    },
    gitRef: {
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
    startedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    completedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    durationMs: {
      type: 'number',
      isNullable: true,
    },
    logsPreview: {
      type: 'string',
      isNullable: true,
    },
    logsTruncated: {
      type: 'boolean',
    },
    hasLogs: {
      type: 'boolean',
    },
    logsSize: {
      type: 'number',
      description: `Size of the captured logs in bytes.`,
    },
  },
} as const;
