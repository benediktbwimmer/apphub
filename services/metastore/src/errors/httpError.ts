export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function toHttpError(err: unknown): HttpError | null {
  if (err instanceof HttpError) {
    return err;
  }
  if (err && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
    const raw = err as { statusCode?: unknown; code?: unknown; message?: unknown; details?: unknown };
    const statusCode = typeof raw.statusCode === 'number' ? raw.statusCode : 500;
    const code = typeof raw.code === 'string' ? raw.code : 'unknown_error';
    const message = typeof raw.message === 'string' ? raw.message : 'Unknown error';
    return new HttpError(statusCode, code, message, raw.details);
  }
  return null;
}
