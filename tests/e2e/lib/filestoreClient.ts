import { FilestoreClient } from '@apphub/filestore-client';
import { FILESTORE_BASE_URL, OPERATOR_TOKEN } from './env';

export interface CreateFilestoreClientOptions {
  baseUrl?: string;
  token?: string;
}

export function createFilestoreClient(options: CreateFilestoreClientOptions = {}): FilestoreClient {
  return new FilestoreClient({
    baseUrl: options.baseUrl ?? FILESTORE_BASE_URL,
    token: options.token ?? OPERATOR_TOKEN,
    userAgent: 'apphub-e2e'
  });
}
