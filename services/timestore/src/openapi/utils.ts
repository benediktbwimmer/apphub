import type { OpenAPIV3 } from 'openapi-types';
import { schemaRef } from './definitions';

export const jsonResponse = (schemaName: string, description: string): OpenAPIV3.ResponseObject => ({
  description,
  content: {
    'application/json': {
      schema: schemaRef(schemaName)
    }
  }
});

export const errorResponse = (description: string): OpenAPIV3.ResponseObject =>
  jsonResponse('ErrorResponse', description);
