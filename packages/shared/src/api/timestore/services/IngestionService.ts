/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_17 } from '../models/def_17';
import type { def_22 } from '../models/def_22';
import type { def_23 } from '../models/def_23';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class IngestionService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Ingest dataset partition
   * Schedules ingestion for a dataset partition. Depending on configuration the job may run inline or be enqueued.
   * @returns def_23 Ingestion job accepted for processing.
   * @returns def_22 Ingestion completed inline.
   * @throws ApiError
   */
  public postDatasetsIngest({
    datasetSlug,
    requestBody,
  }: {
    /**
     * Human-readable slug uniquely identifying a dataset.
     */
    datasetSlug: string,
    requestBody?: def_17,
  }): CancelablePromise<def_23 | def_22> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/datasets/{datasetSlug}/ingest',
      path: {
        'datasetSlug': datasetSlug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid ingestion request.`,
        401: `Authentication is required.`,
        403: `Caller lacks permission to ingest into this dataset.`,
        404: `Dataset not found.`,
        500: `Unexpected error while scheduling ingestion.`,
        503: `Ingestion staging queue is full. Please retry.`,
      },
    });
  }
}
