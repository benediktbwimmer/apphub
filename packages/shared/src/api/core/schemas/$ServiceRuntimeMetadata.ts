/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ServiceRuntimeMetadata = {
  description: `Runtime details gathered from the containerized app connected to the service.`,
  properties: {
    repositoryId: {
      type: 'string',
      description: `Repository ID providing the runtime implementation.`,
    },
    launchId: {
      type: 'string',
      isNullable: true,
    },
    instanceUrl: {
      type: 'string',
      isNullable: true,
      format: 'uri',
    },
    baseUrl: {
      type: 'string',
      isNullable: true,
      format: 'uri',
    },
    previewUrl: {
      type: 'string',
      isNullable: true,
      format: 'uri',
    },
    host: {
      type: 'string',
      isNullable: true,
    },
    port: {
      type: 'number',
      isNullable: true,
      maximum: 65535,
    },
    containerIp: {
      type: 'string',
      isNullable: true,
    },
    containerPort: {
      type: 'number',
      isNullable: true,
      maximum: 65535,
    },
    containerBaseUrl: {
      type: 'string',
      isNullable: true,
      format: 'uri',
    },
    source: {
      type: 'string',
      description: `Origin of the runtime snapshot (for example, service-network synchronizer).`,
      isNullable: true,
    },
    status: {
      type: 'Enum',
      isNullable: true,
    },
    updatedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
  },
} as const;
