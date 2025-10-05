/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_5 } from '../models/def_5';
import type { def_6 } from '../models/def_6';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SystemService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * OpenAPI specification
   * Returns the generated OpenAPI document for the filestore service.
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
   * Legacy health probe
   * Returns basic service health including event subsystem status.
   * @returns def_5 Service is reachable.
   * @throws ApiError
   */
  public getHealthz(): CancelablePromise<def_5> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/healthz',
    });
  }
  /**
   * Service health
   * Reports high-level health information for the filestore service.
   * @returns def_5 Service is reachable.
   * @throws ApiError
   */
  public getHealth(): CancelablePromise<def_5> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health',
    });
  }
  /**
   * Readiness probe
   * Performs dependency checks to ensure the service can accept requests.
   * @returns def_6 All dependencies are available.
   * @throws ApiError
   */
  public getReadyz(): CancelablePromise<def_6> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/readyz',
      errors: {
        503: `One or more dependencies are unavailable.`,
      },
    });
  }
  /**
   * Readiness probe
   * Performs dependency checks to ensure the service can accept requests.
   * @returns def_6 All dependencies are available.
   * @throws ApiError
   */
  public getReady(): CancelablePromise<def_6> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/ready',
      errors: {
        503: `One or more dependencies are unavailable.`,
      },
    });
  }
}
