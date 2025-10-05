/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_13 } from '../models/def_13';
import type { def_18 } from '../models/def_18';
import type { def_19 } from '../models/def_19';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class IngestionService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Ingest dataset partition
   * Schedules ingestion for a dataset partition. Depending on configuration the job may run inline or be enqueued.
   * @returns def_19 Ingestion job accepted for processing.
   * @returns def_18 Ingestion completed inline.
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
    requestBody?: def_13,
  }): CancelablePromise<def_19 | def_18> {
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
      },
    });
  }
}
