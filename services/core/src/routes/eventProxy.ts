import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  normalizeEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeInput
} from '@apphub/event-bus';
import { enqueueWorkflowEvent } from '../queue';

const eventPublishRequestSchema = z
  .object({
    id: z.string().uuid().optional(),
    type: z.string().min(1, 'type is required'),
    source: z.string().min(1, 'source is required'),
    occurredAt: z.union([z.string(), z.date()]).optional(),
    payload: z.unknown().optional(),
    correlationId: z.string().min(1).optional(),
    ttl: z.number().int().positive().optional(),
    metadata: z.unknown().optional()
  })
  .passthrough();

type EventPublishResponse = {
  acceptedAt: string;
  event: EventEnvelope;
};

function parseTokenList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const configuredTokenValues = new Set(
  [
    ...parseTokenList(process.env.APPHUB_EVENT_PROXY_TOKENS),
    ...parseTokenList(process.env.APPHUB_EVENT_PROXY_TOKEN)
  ]
);

const requireToken = configuredTokenValues.size > 0;
let anonymousWarningLogged = false;

function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string') {
    const normalized = authHeader.trim();
    const bearerPrefix = 'bearer ';
    if (normalized.toLowerCase().startsWith(bearerPrefix)) {
      return normalized.slice(bearerPrefix.length).trim();
    }
    if (normalized.length > 0) {
      return normalized;
    }
  }
  const headerToken = request.headers['x-apphub-event-token'];
  if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
    return headerToken.trim();
  }
  if (Array.isArray(headerToken)) {
    for (const candidate of headerToken) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }
  return null;
}

function isValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /required/i.test(error.message) || /must/i.test(error.message);
}

export async function registerEventProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/internal/events/publish', async (request, reply) => {
    if (!requireToken && !anonymousWarningLogged) {
      anonymousWarningLogged = true;
      request.log.warn(
        'APPHUB_EVENT_PROXY_TOKENS not configured; accepting event proxy requests without authentication.'
      );
    }

    if (requireToken) {
      const token = extractToken(request);
      if (!token || !configuredTokenValues.has(token)) {
        reply.status(401);
        return { error: 'Invalid or missing event publish token.' };
      }
    }

    const parsedBody = eventPublishRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      reply.status(400);
      return { error: parsedBody.error.flatten() };
    }

    const eventInput = parsedBody.data as EventEnvelopeInput;

    let envelope: EventEnvelope;
    try {
      envelope = normalizeEventEnvelope(eventInput);
    } catch (err) {
      reply.status(400);
      return { error: err instanceof Error ? err.message : 'Invalid event payload.' };
    }

    try {
      const queued = await enqueueWorkflowEvent(envelope);
      const response: EventPublishResponse = {
        acceptedAt: new Date().toISOString(),
        event: queued
      };
      reply.status(202);
      return { data: response };
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue workflow event via proxy');
      if (isValidationError(err)) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Invalid event payload.' };
      }
      reply.status(502);
      return { error: 'Failed to enqueue workflow event.' };
    }
  });
}
