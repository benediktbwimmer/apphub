/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_12 } from '../models/def_12';
import type { def_13 } from '../models/def_13';
import type { def_28 } from '../models/def_28';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AppsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Search repositories
   * Retrieves repositories matching text, tag, and ingest-status filters. Results include aggregated facets and relevance metadata.
   * @returns def_12 Matching repositories were found.
   * @throws ApiError
   */
  public getApps({
    q,
    tags,
    status,
    ingestedAfter,
    ingestedBefore,
    sort,
    relevance,
  }: {
    /**
     * Free-text query matched against repository name, description, and tags.
     */
    q?: string,
    /**
     * Space or comma-delimited list of tag filters. Each token is matched against stored tag key/value pairs.
     */
    tags?: string,
    /**
     * Space or comma-delimited list of ingest statuses to include (seed, pending, processing, ready, failed).
     */
    status?: string,
    /**
     * Only return repositories ingested on or after the provided ISO timestamp.
     */
    ingestedAfter?: string,
    /**
     * Only return repositories ingested on or before the provided ISO timestamp.
     */
    ingestedBefore?: string,
    /**
     * Sort order applied to search results.
     */
    sort?: 'relevance' | 'updated' | 'name',
    /**
     * Optional JSON-encoded object overriding relevance weights. Unspecified weights fall back to defaults.
     */
    relevance?: string,
  }): CancelablePromise<def_12> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/apps',
      query: {
        'q': q,
        'tags': tags,
        'status': status,
        'ingestedAfter': ingestedAfter,
        'ingestedBefore': ingestedBefore,
        'sort': sort,
        'relevance': relevance,
      },
      errors: {
        400: `The supplied query parameters were invalid.`,
      },
    });
  }
  /**
   * Submit a repository for ingestion
   * Queues a new repository for ingestion. The payload mirrors the information collected in the Apphub submission form.
   * @returns def_13 The repository was accepted for ingestion.
   * @throws ApiError
   */
  public postApps({
    requestBody,
  }: {
    requestBody?: def_28,
  }): CancelablePromise<def_13> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/apps',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The submission payload failed validation.`,
      },
    });
  }
  /**
   * Fetch a repository by identifier
   * Returns repository metadata, ingest status, and latest build/launch information.
   * @returns def_13 Repository details.
   * @throws ApiError
   */
  public getApps1({
    id,
  }: {
    /**
     * Repository identifier.
     */
    id: string,
  }): CancelablePromise<def_13> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/apps/{id}',
      path: {
        'id': id,
      },
      errors: {
        400: `The supplied identifier was invalid.`,
        404: `No repository matched the supplied identifier.`,
      },
    });
  }
}
