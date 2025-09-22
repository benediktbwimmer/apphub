import type { FastifyInstance } from 'fastify';
import { requireOperatorScopes } from './shared/operatorAuth';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/identity', async (request, reply) => {
    const result = await requireOperatorScopes(request, reply, {
      action: 'auth.identity.read',
      resource: 'identity',
      requiredScopes: []
    });
    if (!result.ok) {
      return { error: result.error };
    }

    const { identity } = result.auth;
    reply.status(200);
    return {
      data: {
        subject: identity.subject,
        scopes: Array.from(identity.scopes),
        kind: identity.kind
      }
    };
  });
}
