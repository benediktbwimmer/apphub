/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class EventsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Stream filestore events
   * Provides a server-sent events stream for filestore domain events.
   * @returns string Event stream connection established.
   * @throws ApiError
   */
  public getV1EventsStream({
    backendMountId,
    pathPrefix,
    events,
  }: {
    /**
     * Filter events to a specific backend mount.
     */
    backendMountId?: number,
    /**
     * Restrict events to nodes under the specified path prefix.
     */
    pathPrefix?: string,
    /**
     * Filter by specific event types.
     */
    events?: (Array<string> | string),
  }): CancelablePromise<string> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/events/stream',
      query: {
        'backendMountId': backendMountId,
        'pathPrefix': pathPrefix,
        'events': events,
      },
      errors: {
        500: `Unexpected error occurred while streaming events.`,
      },
    });
  }
}
