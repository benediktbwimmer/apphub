/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_22 } from '../models/def_22';
import type { def_23 } from '../models/def_23';
import type { def_24 } from '../models/def_24';
import type { def_25 } from '../models/def_25';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class EventsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List saved event views
   * Returns saved event views available to the authenticated operator, including shared presets.
   * @returns def_23 Saved event views available to the caller.
   * @throws ApiError
   */
  public getEventsSavedViews(): CancelablePromise<def_23> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/events/saved-views',
      errors: {
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to view saved event overlays.`,
      },
    });
  }
  /**
   * Create a saved event view
   * Persists a reusable filter preset for the events explorer.
   * @returns def_22 Saved event view created successfully.
   * @throws ApiError
   */
  public postEventsSavedViews({
    requestBody,
  }: {
    requestBody?: def_24,
  }): CancelablePromise<def_22> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/events/saved-views',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The saved view payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to create saved event views.`,
        500: `An unexpected error occurred while creating the saved event view.`,
      },
    });
  }
  /**
   * Get a saved event view
   * Retrieves a saved event view, including analytics, owned or shared to the caller.
   * @returns def_22 Saved event view details.
   * @throws ApiError
   */
  public getEventsSavedViews1({
    slug,
  }: {
    /**
     * Saved view slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<def_22> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/events/saved-views/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved view slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to inspect the saved view.`,
        404: `No saved event view matches the supplied slug.`,
      },
    });
  }
  /**
   * Update a saved event view
   * Updates a saved event view owned by the caller.
   * @returns def_22 Saved event view updated.
   * @throws ApiError
   */
  public patchEventsSavedViews({
    slug,
    requestBody,
  }: {
    /**
     * Saved view slug assigned when the record was created.
     */
    slug: string,
    requestBody?: def_25,
  }): CancelablePromise<def_22> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/events/saved-views/{slug}',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The saved view update payload was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to modify the saved view.`,
        404: `The saved event view does not exist.`,
        500: `An unexpected error occurred while updating the saved event view.`,
      },
    });
  }
  /**
   * Delete a saved event view
   * Removes a saved event view owned by the authenticated operator.
   * @returns void
   * @throws ApiError
   */
  public deleteEventsSavedViews({
    slug,
  }: {
    /**
     * Saved view slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/events/saved-views/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved view slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to delete the saved view.`,
        404: `The saved event view does not exist.`,
      },
    });
  }
  /**
   * Record saved event view usage
   * Increments usage metrics after applying a saved event view.
   * @returns def_22 Updated saved event view metrics.
   * @throws ApiError
   */
  public postEventsSavedViewsApply({
    slug,
  }: {
    /**
     * Saved view slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<def_22> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/events/saved-views/{slug}/apply',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved view slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to update the saved view.`,
        404: `The saved event view does not exist.`,
      },
    });
  }
  /**
   * Record saved event view share action
   * Increments share metrics for a saved event view.
   * @returns def_22 Updated saved event view metadata.
   * @throws ApiError
   */
  public postEventsSavedViewsShare({
    slug,
  }: {
    /**
     * Saved view slug assigned when the record was created.
     */
    slug: string,
  }): CancelablePromise<def_22> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/events/saved-views/{slug}/share',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The saved view slug was invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to update the saved view.`,
        404: `The saved event view does not exist.`,
      },
    });
  }
}
