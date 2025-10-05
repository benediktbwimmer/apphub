/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_10 } from '../models/def_10';
import type { def_8 } from '../models/def_8';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SystemService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * OpenAPI specification
   * Returns the generated OpenAPI document for the timestore service.
   * @returns any The generated OpenAPI document.
   * @throws ApiError
   */
  public getOpenapiJson(): CancelablePromise<Record<string, any>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/openapi.json',
    });
  }
  /**
   * Service health
   * Reports lifecycle queue status for the timestore service.
   * @returns def_8 The service is available for traffic.
   * @throws ApiError
   */
  public getHealth(): CancelablePromise<def_8> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health',
      errors: {
        503: `Streaming is enabled but not ready.`,
      },
    });
  }
  /**
   * Readiness probe
   * Performs dependency checks to ensure the service can accept requests.
   * @returns def_10 All dependencies are available.
   * @throws ApiError
   */
  public getReady(): CancelablePromise<def_10> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/ready',
      errors: {
        503: `One or more dependencies are unavailable.`,
      },
    });
  }
}
