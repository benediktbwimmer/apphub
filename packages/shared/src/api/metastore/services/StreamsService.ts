/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class StreamsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Stream record lifecycle events
   * Establishes a server-sent events feed of metastore record create/update/delete notifications. Clients may optionally upgrade to WebSocket to receive the same payloads.
   * @returns string SSE stream of record lifecycle notifications
   * @throws ApiError
   */
  public streamRecords(): CancelablePromise<string> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/stream/records',
      errors: {
        401: `Missing or invalid bearer token`,
        403: `Missing metastore:read scope`,
      },
    });
  }
}
