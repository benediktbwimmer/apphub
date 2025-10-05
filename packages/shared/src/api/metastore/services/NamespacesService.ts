/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NamespaceSummary } from '../models/NamespaceSummary';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class NamespacesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List namespace summaries
   * @returns any Namespace summaries
   * @throws ApiError
   */
  public listNamespaces({
    prefix,
    limit = 25,
    offset,
  }: {
    /**
     * Return namespaces beginning with the provided prefix
     */
    prefix?: string,
    limit?: number,
    offset?: number,
  }): CancelablePromise<{
    pagination?: {
      total: number;
      limit: number;
      offset: number;
      nextOffset?: number;
    };
    namespaces?: Array<NamespaceSummary>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/namespaces',
      query: {
        'prefix': prefix,
        'limit': limit,
        'offset': offset,
      },
      errors: {
        403: `Forbidden`,
      },
    });
  }
}
