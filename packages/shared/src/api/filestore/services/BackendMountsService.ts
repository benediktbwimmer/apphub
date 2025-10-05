/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_12 } from '../models/def_12';
import type { def_13 } from '../models/def_13';
import type { def_14 } from '../models/def_14';
import type { def_9 } from '../models/def_9';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BackendMountsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List backend mounts
   * Returns paginated backend mount records with optional filtering.
   * @returns def_12 Backend mounts matching the supplied filters.
   * @throws ApiError
   */
  public getV1BackendMounts({
    limit,
    offset,
    kinds,
    states,
    accessModes,
    search,
  }: {
    /**
     * Maximum number of mounts to return.
     */
    limit?: number,
    /**
     * Number of mounts to skip before collecting results.
     */
    offset?: number,
    /**
     * Limit results to specific backend implementations.
     */
    kinds?: (Array<'local' | 's3'> | string),
    /**
     * Filter mounts by lifecycle state.
     */
    states?: (Array<'active' | 'inactive' | 'offline' | 'degraded' | 'error' | 'unknown'> | string),
    /**
     * Restrict mounts to specific access modes.
     */
    accessModes?: (Array<'rw' | 'ro'> | string),
    /**
     * Full-text search applied to key, name, and description.
     */
    search?: string,
  }): CancelablePromise<def_12> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/backend-mounts',
      query: {
        'limit': limit,
        'offset': offset,
        'kinds': kinds,
        'states': states,
        'accessModes': accessModes,
        'search': search,
      },
      errors: {
        400: `The supplied filters were invalid.`,
        500: `Unexpected error occurred while listing backend mounts.`,
      },
    });
  }
  /**
   * Create backend mount
   * Registers a new backend mount for storing filestore data.
   * @returns def_9 Backend mount created successfully.
   * @throws ApiError
   */
  public postV1BackendMounts({
    requestBody,
  }: {
    requestBody?: def_13,
  }): CancelablePromise<def_9> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/backend-mounts',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The supplied payload was invalid.`,
        403: `The caller lacks permission to create backend mounts.`,
        409: `A conflicting backend mount already exists.`,
        500: `Unexpected error occurred while creating the backend mount.`,
      },
    });
  }
  /**
   * Retrieve backend mount
   * Returns a single backend mount by identifier.
   * @returns def_9 Backend mount details.
   * @throws ApiError
   */
  public getV1BackendMounts1({
    id,
  }: {
    /**
     * Identifier of the backend mount.
     */
    id: number,
  }): CancelablePromise<def_9> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/backend-mounts/{id}',
      path: {
        'id': id,
      },
      errors: {
        400: `Invalid backend mount identifier supplied.`,
        404: `Backend mount was not found.`,
        500: `Unexpected error retrieving the backend mount.`,
      },
    });
  }
  /**
   * Update backend mount
   * Applies partial updates to an existing backend mount.
   * @returns def_9 Backend mount updated.
   * @throws ApiError
   */
  public patchV1BackendMounts({
    id,
    requestBody,
  }: {
    /**
     * Identifier of the backend mount.
     */
    id: number,
    requestBody?: def_14,
  }): CancelablePromise<def_9> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/v1/backend-mounts/{id}',
      path: {
        'id': id,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The update payload was invalid.`,
        403: `The caller lacks permission to update backend mounts.`,
        404: `Backend mount not found.`,
        409: `Requested update conflicts with the current backend state.`,
        500: `Unexpected error occurred while updating the backend mount.`,
      },
    });
  }
}
