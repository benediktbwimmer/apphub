/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_22 } from '../models/def_22';
import type { def_24 } from '../models/def_24';
import type { def_25 } from '../models/def_25';
import type { def_27 } from '../models/def_27';
import type { def_28 } from '../models/def_28';
import type { def_29 } from '../models/def_29';
import type { def_30 } from '../models/def_30';
import type { def_31 } from '../models/def_31';
import type { def_32 } from '../models/def_32';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class NodesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Create directory
   * Creates a new directory node within the specified backend mount.
   * @returns def_27 Directory already existed and the request was idempotent.
   * @throws ApiError
   */
  public postV1Directories({
    requestBody,
  }: {
    requestBody?: def_28,
  }): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/directories',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The directory request payload was invalid.`,
        409: `The directory could not be created due to conflicts.`,
        500: `Unexpected error occurred while creating the directory.`,
      },
    });
  }
  /**
   * Delete node
   * Deletes a node at the specified path, optionally cascading to children.
   * @returns def_27 Deletion command accepted.
   * @throws ApiError
   */
  public deleteV1Nodes({
    requestBody,
  }: {
    requestBody?: def_29,
  }): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/v1/nodes',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The delete request payload was invalid.`,
        409: `The node could not be deleted due to a conflict.`,
        500: `Unexpected error occurred while deleting the node.`,
      },
    });
  }
  /**
   * List nodes
   * Returns paginated nodes within a backend, supporting path, state, and advanced filters.
   * @returns def_22 Nodes matching the supplied filters.
   * @throws ApiError
   */
  public getV1Nodes({
    backendMountId,
    limit,
    offset,
    path,
    depth,
    search,
    states,
    kinds,
    driftOnly,
    filters,
  }: {
    /**
     * Identifier of the backend mount to inspect.
     */
    backendMountId: number,
    /**
     * Maximum number of nodes to return.
     */
    limit?: number,
    /**
     * Number of nodes to skip before collecting results.
     */
    offset?: number,
    /**
     * Optional path prefix filter.
     */
    path?: string,
    /**
     * Depth relative to the provided path to include in results.
     */
    depth?: number,
    /**
     * Full-text search term across node names and metadata.
     */
    search?: string,
    /**
     * Filter results to nodes in the specified states.
     */
    states?: (Array<'active' | 'inconsistent' | 'missing' | 'deleted'> | string),
    /**
     * Restrict results to files or directories.
     */
    kinds?: (Array<'file' | 'directory'> | string),
    /**
     * When true, returns only nodes flagged for drift.
     */
    driftOnly?: boolean,
    /**
     * JSON encoded advanced filter payload.
     */
    filters?: string,
  }): CancelablePromise<def_22> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/nodes',
      query: {
        'backendMountId': backendMountId,
        'limit': limit,
        'offset': offset,
        'path': path,
        'depth': depth,
        'search': search,
        'states': states,
        'kinds': kinds,
        'driftOnly': driftOnly,
        'filters': filters,
      },
      errors: {
        400: `The query parameters were invalid.`,
        500: `Unexpected error occurred while listing nodes.`,
      },
    });
  }
  /**
   * Move node
   * Moves a node to a new path, optionally across backend mounts.
   * @returns def_27 Move command completed.
   * @throws ApiError
   */
  public postV1NodesMove({
    requestBody,
  }: {
    requestBody?: def_30,
  }): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/nodes/move',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The move request payload was invalid.`,
        409: `The node could not be moved due to a conflict at the destination.`,
        500: `Unexpected error occurred while moving the node.`,
      },
    });
  }
  /**
   * Copy node
   * Copies a node to a new path, optionally across backend mounts.
   * @returns def_27 Copy command completed successfully.
   * @throws ApiError
   */
  public postV1NodesCopy({
    requestBody,
  }: {
    requestBody?: def_31,
  }): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/nodes/copy',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The copy request payload was invalid.`,
        409: `The node could not be copied due to conflicts at the destination.`,
        500: `Unexpected error occurred while copying the node.`,
      },
    });
  }
  /**
   * Update node metadata
   * Sets or unsets metadata fields on an existing node.
   * @returns def_27 Metadata updated successfully.
   * @throws ApiError
   */
  public patchV1NodesMetadata({
    id,
    requestBody,
  }: {
    /**
     * Identifier of the node.
     */
    id: number,
    requestBody?: def_32,
  }): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/v1/nodes/{id}/metadata',
      path: {
        'id': id,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The metadata update payload was invalid.`,
        409: `The metadata could not be updated due to conflicts.`,
        500: `Unexpected error occurred while updating metadata.`,
      },
    });
  }
  /**
   * List child nodes
   * Returns the immediate children for a directory node.
   * @returns def_24 Children for the requested node.
   * @throws ApiError
   */
  public getV1NodesChildren({
    id,
    limit,
    offset,
    search,
    states,
    kinds,
    driftOnly,
    filters,
  }: {
    /**
     * Identifier of the parent node.
     */
    id: number,
    /**
     * Maximum number of children to return.
     */
    limit?: number,
    /**
     * Number of children to skip before collecting results.
     */
    offset?: number,
    /**
     * Full-text search applied to child nodes.
     */
    search?: string,
    /**
     * Filter children by state.
     */
    states?: (Array<'active' | 'inconsistent' | 'missing' | 'deleted'> | string),
    /**
     * Restrict children to files or directories.
     */
    kinds?: (Array<'file' | 'directory'> | string),
    /**
     * When true, returns only children flagged for drift.
     */
    driftOnly?: boolean,
    /**
     * JSON encoded advanced filter payload.
     */
    filters?: string,
  }): CancelablePromise<def_24> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/nodes/{id}/children',
      path: {
        'id': id,
      },
      query: {
        'limit': limit,
        'offset': offset,
        'search': search,
        'states': states,
        'kinds': kinds,
        'driftOnly': driftOnly,
        'filters': filters,
      },
      errors: {
        400: `The supplied parameters were invalid.`,
        404: `The parent node could not be found.`,
        500: `Unexpected error occurred while listing child nodes.`,
      },
    });
  }
  /**
   * Retrieve node by id
   * Returns the full metadata record for a node identified by its numeric identifier.
   * @returns def_25 Node details matching the supplied identifier.
   * @throws ApiError
   */
  public getV1Nodes1({
    id,
  }: {
    /**
     * Identifier of the node to retrieve.
     */
    id: number,
  }): CancelablePromise<def_25> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/nodes/{id}',
      path: {
        'id': id,
      },
      errors: {
        400: `The supplied identifier was invalid.`,
        404: `The node could not be found.`,
        500: `Unexpected error occurred while retrieving the node.`,
      },
    });
  }
  /**
   * Retrieve node by path
   * Returns node metadata for the given backend mount and normalized path.
   * @returns def_25 Node details for the specified path.
   * @throws ApiError
   */
  public getV1NodesByPath({
    backendMountId,
    path,
  }: {
    /**
     * Identifier of the backend mount containing the node.
     */
    backendMountId: number,
    /**
     * Absolute path to the node within the backend mount.
     */
    path: string,
  }): CancelablePromise<def_25> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/v1/nodes/by-path',
      query: {
        'backendMountId': backendMountId,
        'path': path,
      },
      errors: {
        400: `The supplied parameters were invalid.`,
        404: `No node exists at the requested path.`,
        500: `Unexpected error occurred while resolving the node.`,
      },
    });
  }
}
