/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_94 } from '../models/def_94';
import type { def_96 } from '../models/def_96';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SystemService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * OpenAPI specification
   * Returns the generated OpenAPI document for the core service.
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
   * Readiness probe
   * Returns feature flag state and streaming readiness.
   * @returns def_94 The API is healthy and streaming (if enabled) is ready.
   * @throws ApiError
   */
  public getHealth(): CancelablePromise<def_94> {
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
   * Aggregates streaming readiness when the feature flag is enabled.
   * @returns def_96 Core services are ready to receive traffic.
   * @throws ApiError
   */
  public getReadyz(): CancelablePromise<def_96> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/readyz',
      errors: {
        503: `Streaming components are not ready.`,
      },
    });
  }
}
