export class FilestoreClientError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly details: unknown;

  constructor(message: string, options: { statusCode: number; code?: string | null; details?: unknown }) {
    super(message);
    this.name = 'FilestoreClientError';
    this.statusCode = options.statusCode;
    this.code = options.code ?? null;
    this.details = options.details;
  }
}

export class FilestoreStreamClosedError extends Error {
  constructor(message = 'filestore event stream closed') {
    super(message);
    this.name = 'FilestoreStreamClosedError';
  }
}
