import type { FastifyRequest } from 'fastify';

const REQUIRED_SCOPE = process.env.TIMESTORE_REQUIRE_SCOPE;
const ADMIN_SCOPE = process.env.TIMESTORE_ADMIN_SCOPE || REQUIRED_SCOPE;

function extractScopes(request: FastifyRequest): string[] {
  const scopeHeader = request.headers['x-iam-scopes'];
  if (typeof scopeHeader === 'string') {
    return scopeHeader.split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  }
  return [];
}

export async function authorizeDatasetAccess(request: FastifyRequest, datasetSlug: string): Promise<void> {
  if (!REQUIRED_SCOPE) {
    return;
  }

  const scopes = extractScopes(request);

  if (!scopes.includes(REQUIRED_SCOPE)) {
    const message = `Missing required scope ${REQUIRED_SCOPE} for dataset ${datasetSlug}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

export async function authorizeAdminAccess(request: FastifyRequest): Promise<void> {
  if (!ADMIN_SCOPE) {
    return;
  }

  const scopes = extractScopes(request);
  if (!scopes.includes(ADMIN_SCOPE)) {
    const message = `Missing required admin scope ${ADMIN_SCOPE}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}
