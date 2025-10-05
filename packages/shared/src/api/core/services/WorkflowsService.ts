/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_67 } from '../models/def_67';
import type { def_68 } from '../models/def_68';
import type { def_72 } from '../models/def_72';
import type { def_84 } from '../models/def_84';
import type { def_85 } from '../models/def_85';
import type { def_89 } from '../models/def_89';
import type { WorkflowDefinitionCreateRequest } from '../models/WorkflowDefinitionCreateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class WorkflowsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Retrieve workflow topology graph
   * Returns the cached workflow topology graph used by the operations console. Requires the workflows:read or workflows:write operator scope.
   * @returns def_89 Current workflow topology graph snapshot.
   * @throws ApiError
   */
  public getWorkflowsGraph(): CancelablePromise<def_89> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/graph',
      errors: {
        401: `The request lacked an operator token.`,
        403: `The supplied operator token did not include the workflows:read or workflows:write scope.`,
        500: `The server failed to assemble the workflow topology graph.`,
      },
    });
  }
  /**
   * List workflow definitions
   * @returns def_68 Workflow definitions currently available.
   * @throws ApiError
   */
  public getWorkflows(): CancelablePromise<def_68> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows',
      errors: {
        500: `The server failed to fetch workflow definitions.`,
      },
    });
  }
  /**
   * Create a workflow definition
   * Creates a workflow by composing job and service steps. Requires the workflows:write operator scope.
   * @returns def_67 Workflow definition created successfully.
   * @throws ApiError
   */
  public postWorkflows({
    requestBody,
  }: {
    requestBody: WorkflowDefinitionCreateRequest,
  }): CancelablePromise<def_67> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/workflows',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The workflow payload failed validation or the DAG is invalid.`,
        401: `The request lacked an operator token.`,
        403: `The operator token is missing required scopes.`,
        409: `A workflow with the provided slug already exists.`,
        500: `The server failed to create the workflow.`,
      },
    });
  }
  /**
   * Inspect auto materialize status
   * Provides recent auto-materialize runs, in-flight claims, and cooldown status for the specified workflow.
   * @returns def_72 Auto-materialize status for the workflow.
   * @throws ApiError
   */
  public getWorkflowsAutoMaterialize({
    slug,
    limit,
    offset,
    status,
    workflow,
    trigger,
    partition,
    search,
    from,
    to,
  }: {
    /**
     * Workflow slug to inspect.
     */
    slug: string,
    limit?: number,
    offset?: number,
    /**
     * Comma-separated workflow run statuses to filter.
     */
    status?: string,
    /**
     * Comma-separated workflow slugs to filter.
     */
    workflow?: string,
    /**
     * Comma-separated trigger identifiers to filter.
     */
    trigger?: string,
    partition?: string,
    search?: string,
    from?: string,
    to?: string,
  }): CancelablePromise<def_72> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/auto-materialize',
      path: {
        'slug': slug,
      },
      query: {
        'limit': limit,
        'offset': offset,
        'status': status,
        'workflow': workflow,
        'trigger': trigger,
        'partition': partition,
        'search': search,
        'from': from,
        'to': to,
      },
      errors: {
        400: `The request parameters or query failed validation.`,
        404: `Workflow not found.`,
      },
    });
  }
  /**
   * Retrieve workflow asset graph
   * Aggregates asset producers and consumers across all registered workflows.
   * @returns def_84 Current asset graph snapshot.
   * @throws ApiError
   */
  public getAssetsGraph(): CancelablePromise<def_84> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/assets/graph',
      errors: {
        500: `Failed to build the workflow asset graph.`,
      },
    });
  }
  /**
   * Mark workflow asset as stale
   * Marks an asset or partition as stale so downstream workloads know to refresh dependent data.
   * @returns void
   * @throws ApiError
   */
  public postWorkflowsAssetsStale({
    slug,
    assetId,
    requestBody,
  }: {
    /**
     * Workflow slug containing the asset.
     */
    slug: string,
    /**
     * Asset identifier declared by the workflow.
     */
    assetId: string,
    requestBody?: def_85,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/workflows/{slug}/assets/{assetId}/stale',
      path: {
        'slug': slug,
        'assetId': assetId,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The request parameters or body failed validation.`,
        401: `The request lacked an operator token.`,
        403: `The operator token was missing required scopes.`,
        404: `Workflow asset not found.`,
        500: `Failed to mark the asset as stale.`,
      },
    });
  }
  /**
   * Clear stale asset status
   * Clears the stale marker for an asset or partition so downstream jobs can resume.
   * @returns void
   * @throws ApiError
   */
  public deleteWorkflowsAssetsStale({
    slug,
    assetId,
    partitionKey,
  }: {
    /**
     * Workflow slug containing the asset.
     */
    slug: string,
    /**
     * Asset identifier declared by the workflow.
     */
    assetId: string,
    /**
     * Optional partition key to target a specific asset slice.
     */
    partitionKey?: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/workflows/{slug}/assets/{assetId}/stale',
      path: {
        'slug': slug,
        'assetId': assetId,
      },
      query: {
        'partitionKey': partitionKey,
      },
      errors: {
        400: `The request parameters or query failed validation.`,
        401: `The request lacked an operator token.`,
        403: `The operator token was missing required scopes.`,
        404: `Workflow asset not found.`,
        500: `Failed to clear the stale marker.`,
      },
    });
  }
}
