import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './httpError';
import { mapToHttpError } from './mapper';

type ErrorResponsePayload = {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
};

type FastifyErrorHandlerFn = (
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) => void | Promise<void>;

export function createHttpErrorHandler(): FastifyErrorHandlerFn {
  return function httpErrorHandler(
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const httpError = mapToHttpError(error);

    if (httpError.statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error while processing request');
    } else if (!(error instanceof HttpError)) {
      request.log.debug({ err: error }, 'Mapped non-HttpError to HttpError response');
    }

    const response: ErrorResponsePayload = {
      statusCode: httpError.statusCode,
      error: httpError.code,
      message: httpError.message
    };

    if (httpError.details !== undefined) {
      response.details = httpError.details;
    }

    if (!reply.sent) {
      reply.status(httpError.statusCode).send(response);
    }
  };
}
