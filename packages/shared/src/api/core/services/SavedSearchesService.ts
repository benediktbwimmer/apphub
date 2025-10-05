/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_15 } from '../models/def_15';
import type { def_16 } from '../models/def_16';
import type { def_17 } from '../models/def_17';
import type { def_18 } from '../models/def_18';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SavedSearchesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List saved core searches
   * Returns saved core searches owned by the authenticated operator.
   * @returns def_16 Saved searches available to the caller.
   * @throws ApiError
   */
  public getSavedSearches({
    category,
  }: {
    /**
     * Optional category slug used to filter saved searches.
     */
    category?: string,
  }): CancelablePromise<def_16> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/saved-searches',
      query: {
        'category': category,
      },
      errors: {
        400: `The saved search filters were invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to access saved searches.`,
      },
    });
  }
  /**
   * Create a saved core search
   * Persists a reusable core search definition for the authenticated operator.
   * @returns def_15 Saved search created successfully.
   * @throws ApiError
   */
  public postSavedSearches({
    requestBody,
  }: {
    requestBody?: def_17,
  }): CancelablePromise<def_15> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/saved-searches',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The saved search payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to create saved searches.`,
        500: `An unexpected error occurred while creating the saved search.`,
      },
    });
  }
  /**
   * Get a saved core search
   * Retrieves a saved search owned by the authenticated operator.
   * @returns def_15 Saved search details.
   * @throws ApiError
   */
  public getSavedSearches1({
    slug,
  }: {
    /**
     * Saved search slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<def_15> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/saved-searches/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved search slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to inspect the saved search.`,
        404: `No saved search matches the supplied slug.`,
      },
    });
  }
  /**
   * Update a saved core search
   * Updates attributes of an existing saved search owned by the caller.
   * @returns def_15 Saved search updated.
   * @throws ApiError
   */
  public patchSavedSearches({
    slug,
    requestBody,
  }: {
    /**
     * Saved search slug assigned when the record was created.
     */
    slug: string,
    requestBody?: def_18,
  }): CancelablePromise<def_15> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/saved-searches/{slug}',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The update payload was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to modify the saved search.`,
        404: `The saved search does not exist.`,
      },
    });
  }
  /**
   * Delete a saved core search
   * Removes a saved search owned by the authenticated operator.
   * @returns void
   * @throws ApiError
   */
  public deleteSavedSearches({
    slug,
  }: {
    /**
     * Saved search slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/saved-searches/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved search slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to delete the saved search.`,
        404: `The saved search does not exist.`,
      },
    });
  }
  /**
   * Record saved search application
   * Increments usage metrics after applying a saved search.
   * @returns def_15 Updated saved search metrics.
   * @throws ApiError
   */
  public postSavedSearchesApply({
    slug,
  }: {
    /**
     * Saved search slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<def_15> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/saved-searches/{slug}/apply',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved search slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to update the saved search.`,
        404: `The saved search does not exist.`,
      },
    });
  }
  /**
   * Record saved search share action
   * Increments share metrics for a saved search.
   * @returns def_15 Updated saved search metadata.
   * @throws ApiError
   */
  public postSavedSearchesShare({
    slug,
  }: {
    /**
     * Saved search slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<def_15> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/saved-searches/{slug}/share',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved search slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to update the saved search.`,
        404: `The saved search does not exist.`,
      },
    });
  }
}
