/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from '../models/def_0';
import type { def_33 } from '../models/def_33';
import type { def_35 } from '../models/def_35';
import type { def_36 } from '../models/def_36';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ServicesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List registered services
   * @returns def_35 Service inventory and health summary.
   * @throws ApiError
   */
  public getServices({
    source,
  }: {
    source?: 'module' | 'external',
  }): CancelablePromise<def_35> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/services',
      query: {
        'source': source,
      },
      errors: {
        400: `The query parameters were invalid.`,
      },
    });
  }
  /**
   * Register or update a module-managed service
   * Adds or updates a service provisioned via the AppHub module runtime.
   * @returns def_36 Module service updated.
   * @throws ApiError
   */
  public postServicesModule({
    requestBody,
  }: {
    requestBody?: Record<string, any>,
  }): CancelablePromise<def_36> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/services/module',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The service payload failed validation.`,
        401: `Authorization header was missing.`,
        403: `Authorization header was rejected.`,
        503: `Service registry support is disabled on this deployment.`,
      },
    });
  }
  /**
   * Update a registered service
   * Updates metadata for an existing service entry. Requires the service registry bearer token.
   * @returns def_36 Updated service metadata.
   * @throws ApiError
   */
  public patchServices({
    slug,
    requestBody,
  }: {
    /**
     * Service slug.
     */
    slug: string,
    requestBody?: {
      baseUrl?: string;
      status?: 'unknown' | 'healthy' | 'degraded' | 'unreachable';
      statusMessage?: string | null;
      capabilities?: def_0;
      metadata?: def_33;
      lastHealthyAt?: string | null;
    },
  }): CancelablePromise<def_36> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/services/{slug}',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The service payload failed validation.`,
        401: `Authorization header was missing.`,
        403: `Authorization header was rejected.`,
        404: `Service not found.`,
        500: `Failed to update service.`,
        503: `Service registry support is disabled on this deployment.`,
      },
    });
  }
}
