export type CapabilityErrorCode = 'http_error' | 'asset_missing';

export type CapabilityErrorMetadata = Record<string, unknown> & {
  assetId?: string;
  partitionKey?: string | null;
  capability?: string;
  resource?: string;
};

export class CapabilityRequestError extends Error {
  readonly status: number;
  readonly url: string;
  readonly method: string;
  readonly responseBody?: string;
  readonly code: CapabilityErrorCode;
  readonly metadata?: CapabilityErrorMetadata;

  constructor(options: {
    method: string;
    url: string;
    status: number;
    body?: string;
    message?: string;
    code?: CapabilityErrorCode;
    metadata?: CapabilityErrorMetadata;
  }) {
    const baseMessage =
      options.message ?? `Request to ${options.method.toUpperCase()} ${options.url} failed with status ${options.status}`;
    super(baseMessage);
    this.name = 'CapabilityRequestError';
    this.status = options.status;
    this.url = options.url;
    this.method = options.method.toUpperCase();
    this.responseBody = options.body;
    this.code = options.code ?? 'http_error';
    this.metadata = options.metadata;
  }

  static classify(
    error: CapabilityRequestError,
    options: { code: CapabilityErrorCode; metadata?: CapabilityErrorMetadata; message?: string }
  ): CapabilityRequestError {
    const next = new CapabilityRequestError({
      method: error.method,
      url: error.url,
      status: error.status,
      body: error.responseBody,
      message: options.message ?? error.message,
      code: options.code,
      metadata: options.metadata
    });
    next.stack = error.stack;
    return next;
  }
}
