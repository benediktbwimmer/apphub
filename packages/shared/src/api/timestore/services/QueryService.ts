/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_28 } from '../models/def_28';
import type { def_29 } from '../models/def_29';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class QueryService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Execute dataset query
   * Executes a query over the requested dataset using partition pruning and optional downsampling.
   * @returns def_29 Query executed successfully.
   * @throws ApiError
   */
  public postDatasetsQuery({
    datasetSlug,
    requestBody,
  }: {
    /**
     * Human-readable slug uniquely identifying a dataset.
     */
    datasetSlug: string,
    requestBody?: def_28,
  }): CancelablePromise<def_29> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/datasets/{datasetSlug}/query',
      path: {
        'datasetSlug': datasetSlug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid query request.`,
        401: `Authentication is required.`,
        403: `Caller lacks permission to query this dataset.`,
        404: `Dataset not found.`,
        500: `Failed to execute query.`,
      },
    });
  }
}
