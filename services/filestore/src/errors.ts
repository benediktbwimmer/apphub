export type FilestoreErrorCode =
  | 'BACKEND_NOT_FOUND'
  | 'EXECUTOR_NOT_FOUND'
  | 'NODE_EXISTS'
  | 'NODE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'CHILDREN_EXIST'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_PATH';

export class FilestoreError extends Error {
  public readonly code: FilestoreErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: FilestoreErrorCode, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FilestoreError';
    this.code = code;
    this.details = details;
  }
}

export function assertUnreachable(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
