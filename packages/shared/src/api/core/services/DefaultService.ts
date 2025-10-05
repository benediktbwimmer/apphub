/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class DefaultService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postV1Events(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/v1/events',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getMetrics(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/metrics',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getMetricsPrometheus(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/metrics/prometheus',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getJobBundles(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/job-bundles',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postJobBundles(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/job-bundles',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getJobBundles1({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/job-bundles/{slug}',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getJobBundlesVersions({
    slug,
    version,
  }: {
    slug: string,
    version: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/job-bundles/{slug}/versions/{version}',
      path: {
        'slug': slug,
        'version': version,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchJobBundlesVersions({
    slug,
    version,
  }: {
    slug: string,
    version: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/job-bundles/{slug}/versions/{version}',
      path: {
        'slug': slug,
        'version': version,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getJobBundlesVersionsDownload({
    slug,
    version,
  }: {
    slug: string,
    version: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/job-bundles/{slug}/versions/{version}/download',
      path: {
        'slug': slug,
        'version': version,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postJobImportsPreview(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/job-imports/preview',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postJobImports(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/job-imports',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getModulesCatalog(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/modules/catalog',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAiTimestoreSql(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/ai/timestore/sql',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAiBuilderContext(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/ai/builder/context',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAiBuilderGenerations(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/ai/builder/generations',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAiBuilderGenerations({
    generationId,
  }: {
    generationId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/ai/builder/generations/{generationId}',
      path: {
        'generationId': generationId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAiBuilderSuggest(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/ai/builder/suggest',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAiBuilderJobs(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/ai/builder/jobs',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsTriggers({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/triggers',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postWorkflowsTriggers({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/workflows/{slug}/triggers',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsTriggers1({
    slug,
    triggerId,
  }: {
    slug: string,
    triggerId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/triggers/{triggerId}',
      path: {
        'slug': slug,
        'triggerId': triggerId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchWorkflowsTriggers({
    slug,
    triggerId,
  }: {
    slug: string,
    triggerId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/workflows/{slug}/triggers/{triggerId}',
      path: {
        'slug': slug,
        'triggerId': triggerId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteWorkflowsTriggers({
    slug,
    triggerId,
  }: {
    slug: string,
    triggerId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/workflows/{slug}/triggers/{triggerId}',
      path: {
        'slug': slug,
        'triggerId': triggerId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsTriggersDeliveries({
    slug,
    triggerId,
  }: {
    slug: string,
    triggerId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/triggers/{triggerId}/deliveries',
      path: {
        'slug': slug,
        'triggerId': triggerId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowSchedules(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflow-schedules',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowRuns(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflow-runs',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowActivity(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflow-activity',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postWorkflowsSchedules({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/workflows/{slug}/schedules',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchWorkflows({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/workflows/{slug}',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflows({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsRuns({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/runs',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsTimeline({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/timeline',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchWorkflowSchedules({
    scheduleId,
  }: {
    scheduleId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/workflow-schedules/{scheduleId}',
      path: {
        'scheduleId': scheduleId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteWorkflowSchedules({
    scheduleId,
  }: {
    scheduleId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/workflow-schedules/{scheduleId}',
      path: {
        'scheduleId': scheduleId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsStats({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/stats',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsRunMetrics({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/run-metrics',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsAssets({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/assets',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsAssetsHistory({
    slug,
    assetId,
  }: {
    slug: string,
    assetId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/assets/{assetId}/history',
      path: {
        'slug': slug,
        'assetId': assetId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowsAssetsPartitions({
    slug,
    assetId,
  }: {
    slug: string,
    assetId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflows/{slug}/assets/{assetId}/partitions',
      path: {
        'slug': slug,
        'assetId': assetId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putWorkflowsAssetsPartitionParameters({
    slug,
    assetId,
  }: {
    slug: string,
    assetId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/workflows/{slug}/assets/{assetId}/partition-parameters',
      path: {
        'slug': slug,
        'assetId': assetId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteWorkflowsAssetsPartitionParameters({
    slug,
    assetId,
  }: {
    slug: string,
    assetId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/workflows/{slug}/assets/{assetId}/partition-parameters',
      path: {
        'slug': slug,
        'assetId': assetId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postWorkflowsRun({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/workflows/{slug}/run',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowRuns1({
    runId,
  }: {
    runId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflow-runs/{runId}',
      path: {
        'runId': runId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowRunsSteps({
    runId,
  }: {
    runId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflow-runs/{runId}/steps',
      path: {
        'runId': runId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getWorkflowRunsDiff({
    runId,
  }: {
    runId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/workflow-runs/{runId}/diff',
      path: {
        'runId': runId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postWorkflowRunsReplay({
    runId,
  }: {
    runId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/workflow-runs/{runId}/replay',
      path: {
        'runId': runId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getServicesPreview({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/services/{slug}/preview',
      path: {
        'slug': slug,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postServiceConfigImport(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/service-config/import',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postServiceNetworksImport(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/service-networks/import',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public headMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'HEAD',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public optionsMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'OPTIONS',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postMetastore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/metastore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public headTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'HEAD',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public optionsTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'OPTIONS',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postTimestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/timestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public headFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'HEAD',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public optionsFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'OPTIONS',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postFilestore(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/filestore',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAppsHistory({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/apps/{id}/history',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAppsBuilds({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/apps/{id}/builds',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAppsBuilds({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/apps/{id}/builds',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAppsLaunches({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/apps/{id}/launches',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAppsLaunch({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/apps/{id}/launch',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postLaunches(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/launches',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAppsLaunchesStop({
    id,
    launchId,
  }: {
    id: string,
    launchId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/apps/{id}/launches/{launchId}/stop',
      path: {
        'id': id,
        'launchId': launchId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getBuildsLogs({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/builds/{id}/logs',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postBuildsRetry({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/builds/{id}/retry',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getTagsSuggest(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/tags/suggest',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAppsRetry({
    id,
  }: {
    id: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/apps/{id}/retry',
      path: {
        'id': id,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAdminEventHealth(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/admin/event-health',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAdminRuntimeScaling(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/admin/runtime-scaling',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRuntimeScaling({
    target,
  }: {
    target: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/runtime-scaling/{target}',
      path: {
        'target': target,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAdminEventSampling(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/admin/event-sampling',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAdminQueueHealth(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/admin/queue-health',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminEventSamplingReplay(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/event-sampling/replay',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRetriesEventsCancel({
    eventId,
  }: {
    eventId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/retries/events/{eventId}/cancel',
      path: {
        'eventId': eventId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRetriesEventsForce({
    eventId,
  }: {
    eventId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/retries/events/{eventId}/force',
      path: {
        'eventId': eventId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRetriesDeliveriesCancel({
    deliveryId,
  }: {
    deliveryId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/retries/deliveries/{deliveryId}/cancel',
      path: {
        'deliveryId': deliveryId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRetriesDeliveriesForce({
    deliveryId,
  }: {
    deliveryId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/retries/deliveries/{deliveryId}/force',
      path: {
        'deliveryId': deliveryId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRetriesWorkflowStepsCancel({
    stepId,
  }: {
    stepId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/retries/workflow-steps/{stepId}/cancel',
      path: {
        'stepId': stepId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminRetriesWorkflowStepsForce({
    stepId,
  }: {
    stepId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/retries/workflow-steps/{stepId}/force',
      path: {
        'stepId': stepId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getAdminEvents(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/admin/events',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminCoreNukeRunData(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/core/nuke/run-data',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminCoreNuke(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/core/nuke',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postAdminCoreNukeEverything(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/core/nuke/everything',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getObservatoryCalibrations(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/observatory/calibrations',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getObservatoryCalibrations1({
    calibrationId,
  }: {
    calibrationId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/observatory/calibrations/{calibrationId}',
      path: {
        'calibrationId': calibrationId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postObservatoryCalibrationsUpload(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/observatory/calibrations/upload',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getObservatoryPlans(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/observatory/plans',
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getObservatoryPlans1({
    planId,
  }: {
    planId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/observatory/plans/{planId}',
      path: {
        'planId': planId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postObservatoryPlansReprocess({
    planId,
  }: {
    planId: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/observatory/plans/{planId}/reprocess',
      path: {
        'planId': planId,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getServicesPreview1({
    slug,
    wildcard,
  }: {
    slug: string,
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/services/{slug}/preview/{wildcard}',
      path: {
        'slug': slug,
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public headMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'HEAD',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public optionsMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'OPTIONS',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postMetastore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/metastore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public headTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'HEAD',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public optionsTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'OPTIONS',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postTimestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/timestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public getFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public headFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'HEAD',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public deleteFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public optionsFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'OPTIONS',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public patchFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public putFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
  /**
   * @returns any Default Response
   * @throws ApiError
   */
  public postFilestore1({
    wildcard,
  }: {
    wildcard: string,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/filestore/{wildcard}',
      path: {
        'wildcard': wildcard,
      },
    });
  }
}
