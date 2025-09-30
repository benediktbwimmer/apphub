import { ZodError } from 'zod';
import {
  TicketConflictError,
  TicketNotFoundError,
  TicketValidationError
} from '@apphub/ticketing';

export interface ErrorResponse {
  statusCode: number;
  message: string;
  details?: unknown;
}

export const mapErrorToResponse = (error: unknown): ErrorResponse => {
  if (error instanceof TicketNotFoundError) {
    return {
      statusCode: 404,
      message: error.message
    };
  }

  if (error instanceof TicketConflictError) {
    return {
      statusCode: 409,
      message: error.message
    };
  }

  if (error instanceof TicketValidationError) {
    return {
      statusCode: 422,
      message: error.message,
      details: error.issues
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      message: 'Request validation failed',
      details: error.flatten()
    };
  }

  return {
    statusCode: 500,
    message: 'Unexpected error'
  };
};
