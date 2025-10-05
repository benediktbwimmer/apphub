/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_32 } from '../models/def_32';
import type { def_33 } from '../models/def_33';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class QueryService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Execute dataset query
   * Executes a query over the requested dataset using partition pruning and optional downsampling.
   * @returns def_33 Query executed successfully.
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
    requestBody?: def_32,
  }): CancelablePromise<def_33> {
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
