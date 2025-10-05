/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FilestoreHealth } from '../models/FilestoreHealth';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class FilestoreService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Filestore sync health
   * @returns FilestoreHealth Filestore consumer healthy or disabled
   * @throws ApiError
   */
  public filestoreHealth(): CancelablePromise<FilestoreHealth> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/filestore/health',
      errors: {
        503: `Filestore consumer stalled beyond threshold`,
      },
    });
  }
}
