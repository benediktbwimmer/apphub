/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_42 } from '../models/def_42';
import type { def_43 } from '../models/def_43';
import type { def_44 } from '../models/def_44';
import type { def_45 } from '../models/def_45';
import type { def_46 } from '../models/def_46';
import type { def_48 } from '../models/def_48';
import type { def_49 } from '../models/def_49';
import type { def_51 } from '../models/def_51';
import type { def_53 } from '../models/def_53';
import type { def_56 } from '../models/def_56';
import type { def_57 } from '../models/def_57';
import type { def_58 } from '../models/def_58';
import type { def_59 } from '../models/def_59';
import type { def_78 } from '../models/def_78';
import type { def_79 } from '../models/def_79';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class JobsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List job definitions
   * @returns def_45 Job definitions currently available to run.
   * @throws ApiError
   */
  public getJobs({
    moduleId,
  }: {
    /**
     * Optional module identifier to scope job definitions.
     */
    moduleId?: (string | Array<string>),
  }): CancelablePromise<def_45> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/jobs',
      query: {
        'moduleId': moduleId,
      },
    });
  }
  /**
   * Create a job definition
   * Creates a new job definition. Only callers with the jobs:write scope may invoke this endpoint.
   * @returns def_44 The job definition was created successfully.
   * @throws ApiError
   */
  public postJobs({
    requestBody,
  }: {
    requestBody?: def_42,
  }): CancelablePromise<def_44> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The request payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The operator token is missing required scopes.`,
        409: `A job definition with the same slug already exists.`,
        500: `The server failed to persist the job definition.`,
      },
    });
  }
  /**
   * List runtime readiness
   * Reports whether each job runtime (node, python, docker) is ready to execute jobs.
   * @returns def_51 Runtime readiness diagnostics.
   * @throws ApiError
   */
  public getJobsRuntimes(): CancelablePromise<def_51> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/jobs/runtimes',
      errors: {
        500: `Failed to compute runtime readiness.`,
      },
    });
  }
  /**
   * List job runs
   * @returns def_48 Job runs matching the requested filters.
   * @throws ApiError
   */
  public getJobRuns({
    limit,
    offset,
    status,
    job,
    runtime,
    search,
    moduleId,
  }: {
    limit?: number,
    offset?: number,
    /**
     * Comma-separated job run statuses to filter (pending,running,succeeded,failed,canceled,expired).
     */
    status?: string,
    /**
     * Comma-separated list of job slugs to filter.
     */
    job?: string,
    /**
     * Comma-separated list of runtimes to filter (node,python,docker,module).
     */
    runtime?: string,
    search?: string,
    /**
     * Optional module identifier to scope job runs.
     */
    moduleId?: (string | Array<string>),
  }): CancelablePromise<def_48> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/job-runs',
      query: {
        'limit': limit,
        'offset': offset,
        'status': status,
        'job': job,
        'runtime': runtime,
        'search': search,
        'moduleId': moduleId,
      },
      errors: {
        400: `The job run filters were invalid.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to list job runs.`,
      },
    });
  }
  /**
   * Update a job definition
   * Updates an existing job definition. Requires jobs:write scope.
   * @returns def_44 Job definition updated successfully.
   * @throws ApiError
   */
  public patchJobs({
    slug,
    requestBody,
  }: {
    /**
     * Job definition slug.
     */
    slug: string,
    requestBody?: def_43,
  }): CancelablePromise<def_44> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/jobs/{slug}',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The update payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The operator token is missing required scopes.`,
        404: `Job definition not found.`,
        409: `The update conflicted with an existing job definition.`,
        500: `The server failed to persist the job definition.`,
      },
    });
  }
  /**
   * Get job definition with recent runs
   * @returns def_49 Job definition and recent runs.
   * @throws ApiError
   */
  public getJobs1({
    slug,
    limit,
    offset,
    status,
    job,
    runtime,
    search,
    moduleId,
  }: {
    /**
     * Job definition slug.
     */
    slug: string,
    limit?: number,
    offset?: number,
    /**
     * Comma-separated job run statuses to filter (pending,running,succeeded,failed,canceled,expired).
     */
    status?: string,
    /**
     * Comma-separated list of job slugs to filter.
     */
    job?: string,
    /**
     * Comma-separated list of runtimes to filter (node,python,docker,module).
     */
    runtime?: string,
    search?: string,
    /**
     * Optional module identifier to scope job runs.
     */
    moduleId?: (string | Array<string>),
  }): CancelablePromise<def_49> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/jobs/{slug}',
      path: {
        'slug': slug,
      },
      query: {
        'limit': limit,
        'offset': offset,
        'status': status,
        'job': job,
        'runtime': runtime,
        'search': search,
        'moduleId': moduleId,
      },
      errors: {
        400: `The job lookup parameters were invalid.`,
        404: `Job definition not found.`,
        500: `Failed to load job details.`,
      },
    });
  }
  /**
   * Preview job entry point schemas
   * Introspects a bundle entry point to infer input and output schemas.
   * @returns def_53 Inferred schemas for the supplied entry point.
   * @throws ApiError
   */
  public postJobsSchemaPreview({
    requestBody,
  }: {
    requestBody: {
      entryPoint: string;
      runtime?: 'node' | 'python' | 'docker' | 'module';
    },
  }): CancelablePromise<def_53> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs/schema-preview',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The schema preview payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to preview job schemas.`,
        500: `Failed to inspect entry point schemas.`,
      },
    });
  }
  /**
   * Preview Python snippet analysis
   * Analyzes a Python snippet to infer handler metadata before creating a job.
   * @returns def_78 Python snippet analysis results.
   * @throws ApiError
   */
  public postJobsPythonSnippetPreview({
    requestBody,
  }: {
    requestBody: {
      snippet: string;
    },
  }): CancelablePromise<def_78> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs/python-snippet/preview',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The Python snippet payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to analyze Python snippets.`,
        500: `Failed to analyze the Python snippet.`,
      },
    });
  }
  /**
   * Create a Python snippet job
   * Analyzes the provided snippet, generates a bundle, and creates or updates the job definition.
   * @returns def_79 Python snippet job created successfully.
   * @throws ApiError
   */
  public postJobsPythonSnippet({
    requestBody,
  }: {
    requestBody: {
      /**
       * Job slug (alphanumeric, dash, underscore).
       */
      slug: string;
      name: string;
      type: 'batch' | 'service-triggered' | 'manual';
      snippet: string;
      dependencies?: Array<string>;
      timeoutMs?: number;
      versionStrategy: 'auto' | 'manual';
      /**
       * Bundle slug to reuse (optional when versionStrategy is auto).
       */
      bundleSlug?: string;
      bundleVersion?: string;
      jobVersion?: number;
    },
  }): CancelablePromise<def_79> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs/python-snippet',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The Python snippet payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to create Python snippet jobs.`,
        500: `Failed to create Python snippet job.`,
      },
    });
  }
  /**
   * Fetch bundle editor context for a job
   * @returns def_56 Current bundle editor state for the requested job.
   * @throws ApiError
   */
  public getJobsBundleEditor({
    slug,
  }: {
    /**
     * Slug of the job definition to inspect.
     */
    slug: string,
  }): CancelablePromise<def_56> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/jobs/{slug}/bundle-editor',
      path: {
        'slug': slug,
      },
      errors: {
        400: `The provided slug failed validation.`,
        404: `No job or bundle editor snapshot was found for the provided slug.`,
        500: `An unexpected error occurred while loading the bundle editor snapshot.`,
      },
    });
  }
  /**
   * Generate bundle edits with AI
   * Runs an AI provider against the current job bundle and publishes a new version when the response is valid.
   * @returns def_56 A new bundle version was generated and bound to the job.
   * @throws ApiError
   */
  public postJobsBundleAiEdit({
    slug,
    requestBody,
  }: {
    /**
     * Slug of the job whose bundle should be regenerated.
     */
    slug: string,
    requestBody?: def_57,
  }): CancelablePromise<def_56> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs/{slug}/bundle/ai-edit',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Request parameters or generated bundle payload were invalid.`,
        401: `The request lacked an operator token.`,
        403: `The supplied operator token was missing required scopes.`,
        404: `No job or bundle editor snapshot was found for the provided slug.`,
        409: `The job is not bound to a bundle entry point or the generated version already exists.`,
        422: `The AI response did not contain a valid bundle suggestion.`,
        500: `The server failed to publish the generated bundle.`,
        502: `The selected AI provider failed to generate a response.`,
      },
    });
  }
  /**
   * Regenerate bundle editor snapshot
   * Applies manual bundle edits and publishes a new version bound to the job.
   * @returns def_56 Bundle regenerated and bound to the job.
   * @throws ApiError
   */
  public postJobsBundleRegenerate({
    slug,
    requestBody,
  }: {
    /**
     * Job definition slug.
     */
    slug: string,
    requestBody?: def_58,
  }): CancelablePromise<def_56> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs/{slug}/bundle/regenerate',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The bundle regenerate payload failed validation.`,
        401: `The request lacked an operator token.`,
        403: `The supplied operator token was missing required scopes.`,
        404: `Job or bundle editor snapshot not found.`,
        409: `A conflicting bundle version already exists.`,
        422: `The bundle edits were invalid.`,
        500: `Failed to regenerate the bundle.`,
      },
    });
  }
  /**
   * Trigger a job run
   * Queues a run for the specified job definition.
   * @returns def_46 Job run scheduled.
   * @throws ApiError
   */
  public postJobsRun({
    slug,
    requestBody,
  }: {
    /**
     * Job definition slug.
     */
    slug: string,
    requestBody?: def_59,
  }): CancelablePromise<def_46> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/jobs/{slug}/run',
      path: {
        'slug': slug,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The job run payload failed validation.`,
        401: `The caller is unauthenticated.`,
        403: `The caller is not authorized to run the job.`,
        404: `Job definition not found.`,
        500: `Failed to schedule the job run.`,
      },
    });
  }
}
