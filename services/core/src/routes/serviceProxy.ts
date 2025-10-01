import { Buffer } from 'node:buffer';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getServiceBySlug } from '../db';
import { fetchFromService } from '../clients/serviceClient';
import { requireOperatorScopes } from './shared/operatorAuth';
import type { OperatorIdentity } from '../auth/tokens';

type ServiceProxyDefinition = {
  slug: string;
  basePath: string;
  forwardedScopes?: string[];
};

function extractTargetPath(request: FastifyRequest, basePath: string): string {
  const rawUrl = request.raw.url ?? '';
  if (!rawUrl.startsWith(basePath)) {
    return '/';
  }
  let suffix = rawUrl.slice(basePath.length);
  if (!suffix || suffix === '/') {
    return '/';
  }
  if (!suffix.startsWith('/')) {
    suffix = `/${suffix}`;
  }
  return suffix;
}

function resolveForwardedScopes(identity: OperatorIdentity, defaults: string[] | undefined): string[] {
  const scopes = new Set<string>();
  for (const scope of identity.scopes) {
    scopes.add(scope);
  }
  if (defaults) {
    for (const scope of defaults) {
      scopes.add(scope);
    }
  }
  return Array.from(scopes);
}

function buildForwardHeaders(
  request: FastifyRequest,
  identity: OperatorIdentity,
  defaultScopes: string[] | undefined
): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    const lower = key.toLowerCase();
    if (['host', 'connection', 'content-length'].includes(lower)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined) {
          headers.append(key, entry);
        }
      }
      continue;
    }
    headers.set(key, String(value));
  }

  const forwardedScopes = resolveForwardedScopes(identity, defaultScopes);
  if (forwardedScopes.length > 0) {
    headers.set('x-iam-scopes', forwardedScopes.join(','));
  }

  const actorId = identity.userId ?? identity.sessionId ?? identity.subject;
  if (actorId && !headers.has('x-iam-user')) {
    headers.set('x-iam-user', actorId);
  }
  if (!headers.has('x-actor-id')) {
    headers.set('x-actor-id', identity.subject);
  }

  headers.set('x-forwarded-via', 'core-service-proxy');

  return headers;
}

type ResolvedRequestBody = {
  body: unknown;
  contentTypeOverride?: string;
};

type ProxyRequestInit = Omit<RequestInit, 'signal'> & { signal?: AbortSignal };

function resolveRequestBody(request: FastifyRequest): ResolvedRequestBody {
  if (request.body === undefined || request.body === null) {
    return { body: undefined };
  }
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return { body: undefined };
  }

  const body = request.body;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return { body };
  }
  if (typeof body === 'string') {
    return { body };
  }

  const contentTypeHeader = request.headers['content-type'];
  const rawContentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
  const normalizedContentType =
    typeof rawContentType === 'string' ? rawContentType.toLowerCase() : undefined;

  if (typeof normalizedContentType === 'string' && normalizedContentType.includes('application/json')) {
    return { body: JSON.stringify(body) };
  }

  if (typeof body === 'object') {
    try {
      const serialized = JSON.stringify(body);
      const contentTypeOverride = normalizedContentType ? undefined : 'application/json';
      return { body: serialized, contentTypeOverride };
    } catch {
      return { body: String(body) };
    }
  }

  return { body: undefined };
}

async function handleProxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  definition: ServiceProxyDefinition
) {
  const auth = await requireOperatorScopes(request, reply, {
    action: `services.proxy.${definition.slug}`,
    resource: `services/proxy/${definition.slug}`,
    requiredScopes: []
  });
  if (!auth.ok) {
    return { error: auth.error };
  }

  const service = await getServiceBySlug(definition.slug);
  if (!service) {
    reply.status(502);
    return { error: `service ${definition.slug} unavailable` };
  }

  const targetPath = extractTargetPath(request, definition.basePath);
  const headers = buildForwardHeaders(request, auth.auth.identity, definition.forwardedScopes);
  const { body, contentTypeOverride } = resolveRequestBody(request);
  if (contentTypeOverride && !headers.has('content-type')) {
    headers.set('content-type', contentTypeOverride);
  }

  try {
    const requestInit: ProxyRequestInit = {
      method: request.method,
      headers
    };
    if (body !== undefined) {
      (requestInit as Record<string, unknown>).body = body;
    }

    const { response } = await fetchFromService(service, targetPath, requestInit);

    reply.status(response.status);
    for (const [headerKey, headerValue] of response.headers.entries()) {
      if (headerKey.toLowerCase() === 'content-length') {
        continue;
      }
      reply.header(headerKey, headerValue);
    }

    if (response.status === 204 || request.method.toUpperCase() === 'HEAD') {
      return reply.send();
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    reply.header('content-length', buffer.length);
    return reply.send(buffer);
  } catch (err) {
    request.log.error({ err, slug: definition.slug, targetPath }, 'service proxy request failed');
    reply.status(502);
    return { error: 'service proxy request failed' };
  }
}

export async function registerServiceProxyRoutes(
  app: FastifyInstance,
  definitions: ServiceProxyDefinition[]
): Promise<void> {
  for (const definition of definitions) {
    const handler = async (request: FastifyRequest, reply: FastifyReply) =>
      handleProxyRequest(request, reply, definition);

    app.all(definition.basePath, handler);
    app.all(`${definition.basePath}/*`, handler);
  }
}
