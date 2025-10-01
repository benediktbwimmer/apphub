export class CapabilityRequestError extends Error {
  readonly status: number;
  readonly url: string;
  readonly method: string;
  readonly responseBody?: string;

  constructor(options: { method: string; url: string; status: number; body?: string; message?: string }) {
    const baseMessage = options.message ?? `Request to ${options.method.toUpperCase()} ${options.url} failed with status ${options.status}`;
    super(baseMessage);
    this.name = 'CapabilityRequestError';
    this.status = options.status;
    this.url = options.url;
    this.method = options.method.toUpperCase();
    this.responseBody = options.body;
  }
}
