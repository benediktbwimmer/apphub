/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BulkOperationResult } from '../models/BulkOperationResult';
import type { MetastoreAuditDiff } from '../models/MetastoreAuditDiff';
import type { MetastoreAuditEntry } from '../models/MetastoreAuditEntry';
import type { MetastoreRecord } from '../models/MetastoreRecord';
import type { SearchFilter } from '../models/SearchFilter';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class RecordsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Create a record
   * @returns any Record already existed
   * @throws ApiError
   */
  public createRecord({
    requestBody,
  }: {
    requestBody: {
      namespace: string;
      key: string;
      metadata: Record<string, any>;
      tags?: Array<string>;
      owner?: string;
      schemaHash?: string;
    },
  }): CancelablePromise<{
    created?: boolean;
    record?: MetastoreRecord;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/records',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        409: `Conflict (record soft-deleted)`,
      },
    });
  }
  /**
   * List record audit entries
   * @returns any Audit trail entries
   * @throws ApiError
   */
  public listRecordAudit({
    namespace,
    key,
    limit,
    offset,
  }: {
    namespace: string,
    key: string,
    limit?: number,
    offset?: number,
  }): CancelablePromise<{
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
    };
    entries?: Array<MetastoreAuditEntry>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/records/{namespace}/{key}/audit',
      path: {
        'namespace': namespace,
        'key': key,
      },
      query: {
        'limit': limit,
        'offset': offset,
      },
    });
  }
  /**
   * Diff a record audit entry
   * @returns MetastoreAuditDiff Structured diff for the requested audit entry
   * @throws ApiError
   */
  public diffRecordAudit({
    namespace,
    key,
    id,
  }: {
    namespace: string,
    key: string,
    id: number,
  }): CancelablePromise<MetastoreAuditDiff> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/records/{namespace}/{key}/audit/{id}/diff',
      path: {
        'namespace': namespace,
        'key': key,
        'id': id,
      },
      errors: {
        400: `Invalid audit id supplied`,
        403: `Forbidden`,
        404: `Audit entry not found`,
      },
    });
  }
  /**
   * Restore a record from an audit entry or version
   * @returns any Record restored successfully
   * @throws ApiError
   */
  public restoreRecord({
    namespace,
    key,
    requestBody,
  }: {
    namespace: string,
    key: string,
    requestBody: {
      auditId?: number;
      version?: number;
      expectedVersion?: number;
    },
  }): CancelablePromise<{
    restored: boolean;
    record: MetastoreRecord;
    restoredFrom: {
      auditId: number;
      version?: number | null;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/records/{namespace}/{key}/restore',
      path: {
        'namespace': namespace,
        'key': key,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Invalid restore payload`,
        403: `Forbidden`,
        404: `Audit entry or record not found`,
        409: `Version conflict during restore`,
      },
    });
  }
  /**
   * Hard delete a record and its audit trail
   * @returns any Record purged
   * @throws ApiError
   */
  public purgeRecord({
    namespace,
    key,
    requestBody,
  }: {
    namespace: string,
    key: string,
    requestBody?: {
      expectedVersion?: number;
    },
  }): CancelablePromise<{
    purged?: boolean;
    record?: MetastoreRecord;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/records/{namespace}/{key}/purge',
      path: {
        'namespace': namespace,
        'key': key,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        404: `Record not found`,
        409: `Version conflict`,
      },
    });
  }
  /**
   * Fetch a record
   * @returns any Record found
   * @throws ApiError
   */
  public getRecord({
    namespace,
    key,
    includeDeleted,
  }: {
    namespace: string,
    key: string,
    includeDeleted?: boolean,
  }): CancelablePromise<{
    record?: MetastoreRecord;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/records/{namespace}/{key}',
      path: {
        'namespace': namespace,
        'key': key,
      },
      query: {
        'includeDeleted': includeDeleted,
      },
      errors: {
        404: `Record not found`,
      },
    });
  }
  /**
   * Upsert a record
   * @returns any Record updated
   * @throws ApiError
   */
  public upsertRecord({
    namespace,
    key,
    requestBody,
  }: {
    namespace: string,
    key: string,
    requestBody: {
      metadata: Record<string, any>;
      tags?: Array<string>;
      owner?: string;
      schemaHash?: string;
      expectedVersion?: number;
    },
  }): CancelablePromise<{
    created?: boolean;
    record?: MetastoreRecord;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/records/{namespace}/{key}',
      path: {
        'namespace': namespace,
        'key': key,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        409: `Version conflict`,
      },
    });
  }
  /**
   * Patch a record
   * @returns any Record patched
   * @throws ApiError
   */
  public patchRecord({
    namespace,
    key,
    requestBody,
  }: {
    namespace: string,
    key: string,
    requestBody: {
      metadata?: Record<string, any>;
      metadataUnset?: Array<string>;
      tags?: {
        set?: Array<string>;
        add?: Array<string>;
        remove?: Array<string>;
      };
      owner?: string | null;
      schemaHash?: string | null;
      expectedVersion?: number;
    },
  }): CancelablePromise<{
    record?: MetastoreRecord;
  }> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/records/{namespace}/{key}',
      path: {
        'namespace': namespace,
        'key': key,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        404: `Record not found`,
        409: `Version conflict or record soft-deleted`,
      },
    });
  }
  /**
   * Soft delete a record
   * @returns any Record soft-deleted
   * @throws ApiError
   */
  public deleteRecord({
    namespace,
    key,
    requestBody,
  }: {
    namespace: string,
    key: string,
    requestBody?: {
      expectedVersion?: number;
    },
  }): CancelablePromise<{
    deleted?: boolean;
    record?: MetastoreRecord;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/records/{namespace}/{key}',
      path: {
        'namespace': namespace,
        'key': key,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        404: `Record not found`,
        409: `Version conflict`,
      },
    });
  }
  /**
   * Search records
   * @returns any Search results
   * @throws ApiError
   */
  public searchRecords({
    requestBody,
  }: {
    requestBody: {
      namespace: string;
      /**
       * Structured filter tree. Combined with `q` and `preset` using an AND group.
       */
      filter?: SearchFilter;
      /**
       * Lightweight query-string syntax (e.g. `key:foo owner=ops status:"in progress"`). Combined with other filters using AND semantics.
       */
      'q'?: string;
      /**
       * Full-text search across record keys and serialized metadata.
       */
      search?: string;
      /**
       * Named server-defined filter preset. Requires appropriate scopes to use.
       */
      preset?: string;
      limit?: number;
      offset?: number;
      includeDeleted?: boolean;
      projection?: Array<string>;
      /**
       * When true, return a lean default projection (namespace, key, version, updatedAt, owner, schemaHash, tags, deletedAt). Additional fields can be added via `projection`.
       */
      summary?: boolean;
      sort?: Array<{
        field: string;
        direction?: 'asc' | 'desc';
      }>;
    },
  }): CancelablePromise<{
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
    };
    records?: Array<MetastoreRecord>;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/records/search',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Apply bulk operations
   * @returns any Bulk operations succeeded
   * @throws ApiError
   */
  public bulkRecords({
    requestBody,
  }: {
    requestBody: {
      operations: Array<({
        type?: 'upsert' | 'put' | 'create';
        namespace: string;
        key: string;
        metadata: Record<string, any>;
        tags?: Array<string>;
        owner?: string;
        schemaHash?: string;
        expectedVersion?: number;
      } | {
        type: 'delete';
        namespace: string;
        key: string;
        expectedVersion?: number;
      })>;
      continueOnError?: boolean;
    },
  }): CancelablePromise<{
    operations?: Array<BulkOperationResult>;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/records/bulk',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        404: `Record not found`,
        409: `Version conflict`,
      },
    });
  }
}
