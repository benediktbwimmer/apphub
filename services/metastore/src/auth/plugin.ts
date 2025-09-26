import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ServiceConfig } from '../config/serviceConfig';
import { createDisabledIdentity, createIdentityFromToken, type AuthIdentity } from './identity';

declare module 'fastify' {
  interface FastifyRequest {
    identity: AuthIdentity;
  }
}

type AuthPluginOptions = {
  config: ServiceConfig;
};

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(' ');
  if (!value) {
    return null;
  }
  if (scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  const token = value.trim();
  return token.length > 0 ? token : null;
}

type TokenIndex = Map<string, AuthIdentity>;

function buildTokenIndex(config: ServiceConfig): TokenIndex {
  const index: TokenIndex = new Map();
  for (const definition of config.tokens) {
    const identity = createIdentityFromToken(definition, definition.token);
    index.set(definition.token, identity);
  }
  return index;
}

function unauthorized(reply: FastifyReply, message: string): void {
  reply.code(401).send({
    statusCode: 401,
    error: 'Unauthorized',
    message
  });
}

export const authPlugin = fp<AuthPluginOptions>(async (app, options) => {
  const { config } = options;
  let tokenIndex = buildTokenIndex(config);

  app.decorateRequest<AuthIdentity | null>('identity', null);

  app.addHook('onRequest', async (request, reply) => {
    if (config.authDisabled) {
      request.identity = createDisabledIdentity();
      return;
    }

    const token = extractBearerToken(request);
    if (!token) {
      unauthorized(reply, 'Missing bearer token');
      return reply; // stop further processing
    }

    const cached = tokenIndex.get(token);
    if (!cached) {
      unauthorized(reply, 'Invalid bearer token');
      return reply;
    }

    request.identity = cached;
  });
});

export type AuthPlugin = typeof authPlugin;
