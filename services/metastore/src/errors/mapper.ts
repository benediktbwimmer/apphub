import { OptimisticLockError, RecordDeletedError } from '../db/recordsRepository';
import { HttpError, toHttpError } from './httpError';

export function mapToHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) {
    return err;
  }

  if (err instanceof OptimisticLockError) {
    return new HttpError(409, 'version_conflict', err.message);
  }

  if (err instanceof RecordDeletedError) {
    return new HttpError(409, 'record_deleted', err.message);
  }

  const httpLike = toHttpError(err);
  if (httpLike) {
    return httpLike;
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  return new HttpError(500, 'internal_error', message);
}
