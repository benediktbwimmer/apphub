/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SystemService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Health probe
   * @returns any Service healthy
   * @throws ApiError
   */
  public health(): CancelablePromise<{
    status?: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health',
    });
  }
  /**
   * Health probe
   * @returns any Service healthy
   * @throws ApiError
   */
  public healthz(): CancelablePromise<{
    status?: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/healthz',
    });
  }
  /**
   * Readiness probe
   * @returns any Service ready
   * @throws ApiError
   */
  public readyz(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/readyz',
    });
  }
  /**
   * Prometheus metrics
   * @returns any Metrics payload (text/plain)
   * @throws ApiError
   */
  public metrics(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/metrics',
      errors: {
        503: `Metrics disabled`,
      },
    });
  }
  /**
   * Reload bearer tokens
   * @returns any Tokens reloaded
   * @throws ApiError
   */
  public reloadTokens(): CancelablePromise<{
    reloaded?: boolean;
    tokenCount?: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/tokens/reload',
    });
  }
  /**
   * OpenAPI specification
   * @returns any OpenAPI document
   * @throws ApiError
   */
  public getOpenApiDocument(): CancelablePromise<Record<string, any>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/openapi.json',
    });
  }
}
