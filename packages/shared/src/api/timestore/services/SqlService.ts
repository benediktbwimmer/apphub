/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_34 } from '../models/def_34';
import type { def_37 } from '../models/def_37';
import type { def_39 } from '../models/def_39';
import type { def_42 } from '../models/def_42';
import type { def_43 } from '../models/def_43';
import type { def_45 } from '../models/def_45';
import type { def_46 } from '../models/def_46';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SqlService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Describe SQL schema
   * Returns the current logical schema exposed to the SQL runtime.
   * @returns def_37 SQL schema snapshot for available datasets.
   * @throws ApiError
   */
  public getSqlSchema(): CancelablePromise<def_37> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/sql/schema',
      errors: {
        401: `Authentication is required.`,
        403: `Caller lacks permission to inspect SQL metadata.`,
        500: `Failed to load SQL schema information.`,
      },
    });
  }
  /**
   * Execute read-only SQL query
   * Runs a read-only SELECT statement against the SQL runtime and returns the result set in the requested format.
   * @returns def_39 Query executed successfully.
   * @throws ApiError
   */
  public postSqlRead({
    requestBody,
  }: {
    requestBody?: def_34,
  }): CancelablePromise<def_39> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/sql/read',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid SQL read request.`,
        401: `Authentication is required.`,
        403: `Caller lacks permission to run SQL queries.`,
        406: `Requested response format is not supported.`,
        500: `SQL read execution failed.`,
      },
    });
  }
  /**
   * List saved SQL queries
   * @returns def_42 Saved SQL queries accessible to the caller.
   * @throws ApiError
   */
  public getSqlSaved(): CancelablePromise<def_42> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/sql/saved',
      errors: {
        401: `Authentication is required.`,
        403: `Caller lacks permission to manage saved SQL queries.`,
        500: `Failed to load saved queries.`,
      },
    });
  }
  /**
   * Get saved SQL query
   * @returns def_43 Saved SQL query definition.
   * @throws ApiError
   */
  public getSqlSaved1({
    id,
  }: {
    /**
     * Unique identifier of the saved query.
     */
    id: string,
  }): CancelablePromise<def_43> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/sql/saved/{id}',
      path: {
        'id': id,
      },
      errors: {
        401: `Authentication is required.`,
        403: `Caller lacks permission to access saved SQL queries.`,
        404: `Saved SQL query not found.`,
        500: `Failed to load saved SQL query.`,
      },
    });
  }
  /**
   * Create or update saved SQL query
   * @returns def_43 Saved SQL query persisted successfully.
   * @throws ApiError
   */
  public putSqlSaved({
    id,
    requestBody,
  }: {
    /**
     * Unique identifier of the saved query.
     */
    id: string,
    requestBody?: def_45,
  }): CancelablePromise<def_43> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/sql/saved/{id}',
      path: {
        'id': id,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid saved query payload.`,
        401: `Authentication is required.`,
        403: `Caller lacks permission to manage saved SQL queries.`,
        500: `Failed to persist saved SQL query.`,
      },
    });
  }
  /**
   * Delete saved SQL query
   * @returns void
   * @throws ApiError
   */
  public deleteSqlSaved({
    id,
  }: {
    /**
     * Unique identifier of the saved query.
     */
    id: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/sql/saved/{id}',
      path: {
        'id': id,
      },
      errors: {
        401: `Authentication is required.`,
        403: `Caller lacks permission to manage saved SQL queries.`,
        404: `Saved SQL query not found.`,
        500: `Failed to delete saved SQL query.`,
      },
    });
  }
  /**
   * Execute SQL statement
   * Executes a SQL statement with optional streaming responses for large result sets.
   * @returns def_46 Statement executed successfully.
   * @throws ApiError
   */
  public postSqlExec({
    requestBody,
  }: {
    requestBody?: def_34,
  }): CancelablePromise<def_46> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/sql/exec',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid SQL execution request.`,
        401: `Authentication is required.`,
        403: `Caller lacks permission to execute SQL statements.`,
        406: `Requested response format is not supported.`,
        500: `SQL execution failed.`,
      },
    });
  }
}
