import type { FastifyBaseLogger } from 'fastify';
import { registerEventSchemaDefinition } from '../eventSchemas';
import type { JsonValue } from '../db/types';

type JsonSchema = JsonValue;

const anyJsonValueSchema: JsonSchema = {
  type: ['object', 'array', 'string', 'number', 'boolean', 'null']
};

const freshnessSchema: JsonSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    maxAgeMs: { type: ['integer', 'number', 'null'] },
    ttlMs: { type: ['integer', 'number', 'null'] },
    cadenceMs: { type: ['integer', 'number', 'null'] }
  }
};

const assetProducedSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'assetId',
    'workflowDefinitionId',
    'workflowSlug',
    'workflowRunId',
    'workflowRunStepId',
    'stepId',
    'producedAt'
  ],
  properties: {
    assetId: { type: 'string', minLength: 1 },
    workflowDefinitionId: { type: 'string', minLength: 1 },
    workflowSlug: { type: 'string', minLength: 1 },
    workflowRunId: { type: 'string', minLength: 1 },
    workflowRunStepId: { type: 'string', minLength: 1 },
    stepId: { type: 'string', minLength: 1 },
    producedAt: { type: 'string', minLength: 1 },
    freshness: freshnessSchema,
    partitionKey: { type: ['string', 'null'] },
    payload: anyJsonValueSchema,
    parameters: {
      type: ['object', 'null'],
      additionalProperties: anyJsonValueSchema
    }
  }
};

const assetExpiredSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'assetId',
    'workflowDefinitionId',
    'workflowSlug',
    'workflowRunId',
    'workflowRunStepId',
    'stepId',
    'producedAt',
    'expiresAt',
    'requestedAt',
    'reason'
  ],
  properties: {
    assetId: { type: 'string', minLength: 1 },
    workflowDefinitionId: { type: 'string', minLength: 1 },
    workflowSlug: { type: 'string', minLength: 1 },
    workflowRunId: { type: 'string', minLength: 1 },
    workflowRunStepId: { type: 'string', minLength: 1 },
    stepId: { type: 'string', minLength: 1 },
    producedAt: { type: 'string', minLength: 1 },
    expiresAt: { type: 'string', minLength: 1 },
    requestedAt: { type: 'string', minLength: 1 },
    reason: { enum: ['ttl', 'cadence', 'manual'] },
    freshness: freshnessSchema,
    partitionKey: { type: ['string', 'null'] },
    payload: anyJsonValueSchema,
    parameters: {
      type: ['object', 'null'],
      additionalProperties: anyJsonValueSchema
    }
  }
};

const defaultSchemas: Array<{
  eventType: string;
  schema: JsonSchema;
  metadata: null;
  author: string | null;
}> = [
  // Core asset lifecycle events
  {
    eventType: 'asset.produced',
    schema: assetProducedSchema,
    metadata: null,
    author: 'apphub-core'
  },
  {
    eventType: 'asset.expired',
    schema: assetExpiredSchema,
    metadata: null,
    author: 'apphub-core'
  },
  // Observatory module events (permissive payloads so the demo module keeps working during prototyping)
  {
    eventType: 'observatory.minute.partition-ready',
    schema: {
      type: 'object',
      additionalProperties: true
    },
    metadata: null,
    author: 'apphub-core'
  },
  {
    eventType: 'observatory.dashboard.updated',
    schema: {
      type: 'object',
      additionalProperties: true
    },
    metadata: null,
    author: 'apphub-core'
  },
  {
    eventType: 'observatory.calibration.updated',
    schema: {
      type: 'object',
      required: ['payload'],
      properties: {
        payload: {
          type: 'object',
          additionalProperties: true
        }
      },
      additionalProperties: false
    },
    metadata: null,
    author: 'apphub-core'
  },
  {
    eventType: 'observatory.burst.finished',
    schema: {
      type: 'object',
      additionalProperties: true
    },
    metadata: null,
    author: 'apphub-core'
  }
];

export async function registerDefaultEventSchemas(logger: FastifyBaseLogger): Promise<void> {
  for (const definition of defaultSchemas) {
    try {
      const record = await registerEventSchemaDefinition({
        eventType: definition.eventType,
        schema: definition.schema,
        metadata: definition.metadata,
        author: definition.author,
        status: 'active'
      });
      logger.debug(
        {
          eventType: record.eventType,
          version: record.version,
          status: record.status
        },
        'Default event schema registered'
      );
    } catch (err) {
      logger.warn(
        {
          eventType: definition.eventType,
          error: err instanceof Error ? err.message : String(err)
        },
        'Failed to register default event schema'
      );
    }
  }
}
