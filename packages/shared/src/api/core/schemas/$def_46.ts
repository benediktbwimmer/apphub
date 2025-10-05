/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_46 = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    jobDefinitionId: {
      type: 'string',
      isRequired: true,
    },
    status: {
      type: 'Enum',
      isRequired: true,
    },
    parameters: {
      type: 'def_0',
      isRequired: true,
    },
    result: {
      type: 'def_0',
      isRequired: true,
    },
    errorMessage: {
      type: 'string',
      isNullable: true,
    },
    logsUrl: {
      type: 'string',
      isNullable: true,
      format: 'uri',
    },
    metrics: {
      type: 'def_0',
      isRequired: true,
    },
    context: {
      type: 'def_0',
      isRequired: true,
    },
    timeoutMs: {
      type: 'number',
      isNullable: true,
    },
    attempt: {
      type: 'number',
      isRequired: true,
      minimum: 1,
    },
    maxAttempts: {
      type: 'number',
      isNullable: true,
      minimum: 1,
    },
    durationMs: {
      type: 'number',
      isNullable: true,
    },
    scheduledAt: {
      type: 'string',
      isNullable: true,
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
  },
} as const;
