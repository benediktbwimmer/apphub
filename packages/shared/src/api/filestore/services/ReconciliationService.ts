/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_33 } from '../models/def_33';
import type { def_34 } from '../models/def_34';
import type { def_38 } from '../models/def_38';
import type { def_39 } from '../models/def_39';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ReconciliationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Enqueue reconciliation job
   * Schedules a reconciliation job for the specified path and backend mount.
   * @returns def_34 Reconciliation job accepted for processing.
   * @throws ApiError
   */
  public postV1Reconciliation({
    requestBody,
  }: {
    requestBody?: def_33,
  }): CancelablePromise<def_34> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/reconciliation',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The reconciliation request payload was invalid.`,
        500: `Unexpected error occurred while enqueuing the reconciliation job.`,
      },
    });
  }
  /**
   * List reconciliation jobs
   * Returns historical reconciliation jobs for auditing and monitoring.
   * @returns def_38 Reconciliation jobs matching the supplied filters.
   * @throws ApiError
   */
  public getV1ReconciliationJobs({
    backendMountId,
    path,
    status,
    limit,
    offset,
  }: {
    /**
     * Filter jobs by backend mount identifier.
     */
    backendMountId?: number,
    /**
     * Filter jobs by path prefix.
     */
    path?: string,
    /**
     * Restrict results to jobs in the specified states.
     */
    status?: (Array<'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'> | string),
    /**
     * Maximum number of jobs to return.
     */
    limit?: number,
    /**
     * Number of jobs to skip before collecting results.
     */
    offset?: number,
  }): CancelablePromise<def_38> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/reconciliation/jobs',
      query: {
        'backendMountId': backendMountId,
        'path': path,
        'status': status,
        'limit': limit,
        'offset': offset,
      },
      errors: {
        400: `The reconciliation job query parameters were invalid.`,
        403: `The caller lacks permission to inspect reconciliation jobs.`,
        500: `Unexpected error occurred while listing reconciliation jobs.`,
      },
    });
  }
  /**
   * Retrieve reconciliation job
   * Fetches a single reconciliation job by identifier.
   * @returns def_39 Reconciliation job details.
   * @throws ApiError
   */
  public getV1ReconciliationJobs1({
    id,
  }: {
    /**
     * Identifier of the reconciliation job.
     */
    id: number,
  }): CancelablePromise<def_39> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/reconciliation/jobs/{id}',
      path: {
        'id': id,
      },
      errors: {
        400: `The supplied identifier was invalid.`,
        403: `The caller lacks permission to read reconciliation jobs.`,
        404: `Reconciliation job not found.`,
        500: `Unexpected error occurred while retrieving the reconciliation job.`,
      },
    });
  }
}
