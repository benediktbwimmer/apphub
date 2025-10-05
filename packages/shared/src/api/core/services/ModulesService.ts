/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_39 } from '../models/def_39';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ModulesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Publish a module artifact
   * Stores a module bundle on disk and registers it for module runtime execution.
   * @returns def_39 Module artifact registered.
   * @throws ApiError
   */
  public postModuleRuntimeArtifacts({
    requestBody,
  }: {
    requestBody: {
      moduleId: string;
      moduleVersion: string;
      displayName?: string | null;
      description?: string | null;
      keywords?: Array<string>;
      manifest: Record<string, any>;
      artifact: ({
        storage?: 'inline';
        filename?: string;
        contentType?: string;
        /**
         * Base64-encoded module bundle contents.
         */
        data: string;
        size?: number;
        checksum?: string;
      } | {
        storage: 's3';
        bucket: string;
        key: string;
        contentType?: string;
        size: number;
        /**
         * Hex-encoded SHA-256 checksum of the stored artifact.
         */
        checksum: string;
      });
    },
  }): CancelablePromise<def_39> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/module-runtime/artifacts',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The module artifact payload failed validation.`,
        401: `Authorization header was missing.`,
        403: `Authorization header was rejected.`,
        500: `Failed to store the module artifact.`,
        503: `Service registry support is disabled on this deployment.`,
      },
    });
  }
}
