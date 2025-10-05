/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_27 } from '../models/def_27';
import type { def_40 } from '../models/def_40';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class FilesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Upload or replace file content
   * Uploads file content to the filestore, optionally replacing an existing file when overwrite is enabled.
   * @returns def_27 File upload accepted (idempotent replay).
   * @throws ApiError
   */
  public postV1Files({
    formData,
  }: {
    formData: {
      /**
       * Binary payload for the file to upload.
       */
      file: Blob;
      /**
       * Identifier of the backend mount receiving the file.
       */
      backendMountId: number;
      /**
       * Path where the file will be stored.
       */
      path: string;
      /**
       * Optional JSON object string containing metadata to assign to the file.
       */
      metadata?: string;
      /**
       * When true, replaces existing file content at the target path.
       */
      overwrite?: boolean;
      /**
       * Optional idempotency key for safely retrying the upload.
       */
      idempotencyKey?: string;
    },
  }): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/files',
      formData: formData,
      mediaType: 'multipart/form-data',
      errors: {
        400: `The upload request was invalid.`,
        409: `A conflicting node prevented the upload.`,
        415: `Multipart form data was not supplied.`,
        422: `Checksum or content hash mismatched the provided value.`,
        500: `Unexpected error occurred during upload.`,
      },
    });
  }
  /**
   * Download file content
   * Streams stored file content. Supports HTTP range requests when metadata allows.
   * @returns binary Entire file content streamed to the client.
   * @throws ApiError
   */
  public getV1FilesContent({
    id,
  }: {
    /**
     * Identifier of the file node to download.
     */
    id: number,
  }): CancelablePromise<Blob> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/files/{id}/content',
      path: {
        'id': id,
      },
      errors: {
        400: `The supplied identifier or range header was invalid.`,
        404: `The requested file could not be found.`,
        409: `The target node does not represent a downloadable file.`,
        416: `The requested byte range is invalid for the file.`,
        500: `Unexpected error occurred while reading from the backend.`,
      },
    });
  }
  /**
   * Create presigned download
   * Generates a presigned URL that allows direct download from the backing storage.
   * @returns def_40 Presigned URL generated successfully.
   * @throws ApiError
   */
  public getV1FilesPresign({
    id,
    expiresIn,
  }: {
    /**
     * Identifier of the file node.
     */
    id: number,
    /**
     * Requested TTL for the presigned URL in seconds.
     */
    expiresIn?: number,
  }): CancelablePromise<def_40> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/files/{id}/presign',
      path: {
        'id': id,
      },
      query: {
        'expiresIn': expiresIn,
      },
      errors: {
        400: `The request parameters were invalid.`,
        404: `The requested file could not be found.`,
        409: `The node is not eligible for presigned downloads.`,
        500: `Unexpected error occurred while generating the presigned URL.`,
      },
    });
  }
}
