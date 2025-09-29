import type { FastifyReply } from 'fastify';
import { JobServiceError } from '../../jobs/service';

export function isJobServiceError(error: unknown): error is JobServiceError {
  return error instanceof JobServiceError;
}

export function mapJobServiceError<T>(reply: FastifyReply, error: JobServiceError<T>): T {
  reply.status(error.statusCode);
  return error.payload;
}
