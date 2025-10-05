/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SchemaDefinition } from '../models/SchemaDefinition';
import type { SchemaDefinitionInput } from '../models/SchemaDefinitionInput';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SchemasService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Fetch schema definition by hash
   * @returns any Schema definition for the supplied hash
   * @throws ApiError
   */
  public getSchemaDefinition({
    hash,
  }: {
    /**
     * Schema hash (for example, sha256:...)
     */
    hash: string,
  }): CancelablePromise<(SchemaDefinition & {
    cache: 'cache' | 'database';
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/schemas/{hash}',
      path: {
        'hash': hash,
      },
      errors: {
        400: `Invalid schema hash`,
        403: `Forbidden`,
        404: `Schema not registered`,
      },
    });
  }
  /**
   * Register or update a schema definition
   * @returns any Schema definition updated
   * @throws ApiError
   */
  public registerSchemaDefinition({
    requestBody,
  }: {
    requestBody: SchemaDefinitionInput,
  }): CancelablePromise<{
    created: boolean;
    schema: SchemaDefinition;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/schemas',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid schema definition payload`,
        403: `Forbidden`,
      },
    });
  }
}
