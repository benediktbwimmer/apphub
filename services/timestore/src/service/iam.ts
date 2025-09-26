import type { FastifyRequest } from 'fastify';

const REQUIRED_SCOPE = process.env.TIMESTORE_REQUIRE_SCOPE;

export async function authorizeDatasetAccess(request: FastifyRequest, datasetSlug: string): Promise<void> {
  if (!REQUIRED_SCOPE) {
    return;
  }

  const scopeHeader = request.headers['x-iam-scopes'];
  const scopes = typeof scopeHeader === 'string'
    ? scopeHeader.split(',').map((scope) => scope.trim())
    : [];

  if (!scopes.includes(REQUIRED_SCOPE)) {
    const message = `Missing required scope ${REQUIRED_SCOPE} for dataset ${datasetSlug}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}
