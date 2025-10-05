/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_89 = {
  data: {
    version: 'v1' | 'v2';
    generatedAt: string;
    nodes: {
      workflows: Array<{
        id: string;
        slug: string;
        name: string;
        version: number;
        description?: string | null;
        createdAt: string;
        updatedAt: string;
        metadata?: any | null;
        annotations: {
          /**
           * Annotation tags that can be used for filtering and grouping.
           */
          tags: Array<string>;
          ownerName?: string | null;
          ownerContact?: string | null;
          team?: string | null;
          domain?: string | null;
          environment?: string | null;
          slo?: string | null;
        };
      }>;
      steps: Array<{
        id: string;
        workflowId: string;
        name: string;
        description?: string | null;
        type: 'job' | 'service' | 'fanout';
        dependsOn: Array<string>;
        dependents: Array<string>;
        runtime: ({
          type: 'job';
          jobSlug: string;
          bundleStrategy?: 'latest' | 'pinned';
          bundleSlug?: string | null;
          bundleVersion?: string | null;
          exportName?: string | null;
          timeoutMs?: number | null;
        } | {
          type: 'service';
          serviceSlug: string;
          timeoutMs?: number | null;
          requireHealthy?: boolean | null;
          allowDegraded?: boolean | null;
          captureResponse?: boolean | null;
        } | {
          type: 'fanout';
          collection: ((string | number | boolean | Record<string, any>) | null);
          maxItems?: number | null;
          maxConcurrency?: number | null;
          storeResultsAs?: string | null;
          template: {
            id: string;
            name?: string | null;
            runtime: ({
              type: 'job';
              jobSlug: string;
              bundleStrategy?: 'latest' | 'pinned';
              bundleSlug?: string | null;
              bundleVersion?: string | null;
              exportName?: string | null;
              timeoutMs?: number | null;
            } | {
              type: 'service';
              serviceSlug: string;
              timeoutMs?: number | null;
              requireHealthy?: boolean | null;
              allowDegraded?: boolean | null;
              captureResponse?: boolean | null;
            });
          };
        });
      }>;
      triggers: Array<({
        id: string;
        workflowId: string;
        kind: 'definition';
        triggerType: string;
        options?: ((string | number | boolean | Record<string, any>) | null);
        schedule?: ({
          cron: string;
          timezone?: string | null;
          startWindow?: string | null;
          endWindow?: string | null;
          catchUp?: boolean | null;
        } | null);
      } | {
        id: string;
        workflowId: string;
        kind: 'event';
        name?: string | null;
        description?: string | null;
        status: 'active' | 'disabled';
        eventType: string;
        eventSource?: string | null;
        predicates: Array<{
          type: 'jsonPath';
          path: string;
          operator: string;
          value?: ((string | number | boolean | Record<string, any>) | null);
          values?: Array<((string | number | boolean | Record<string, any>) | null)>;
          caseSensitive?: boolean;
          flags?: string | null;
        }>;
        parameterTemplate: ((string | number | boolean | Record<string, any>) | null);
        runKeyTemplate: string | null;
        throttleWindowMs: number | null;
        throttleCount: number | null;
        maxConcurrency: number | null;
        idempotencyKeyExpression: string | null;
        metadata: ((string | number | boolean | Record<string, any>) | null);
        createdAt: string;
        updatedAt: string;
        createdBy?: string | null;
        updatedBy?: string | null;
      })>;
      schedules: Array<{
        id: string;
        workflowId: string;
        name?: string | null;
        description?: string | null;
        cron: string;
        timezone: string | null;
        parameters: ((string | number | boolean | Record<string, any>) | null);
        startWindow: string | null;
        endWindow: string | null;
        catchUp: boolean;
        nextRunAt: string | null;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
      assets: Array<{
        id: string;
        assetId: string;
        normalizedAssetId: string;
        annotations: {
          /**
           * Annotation tags that can be used for filtering and grouping.
           */
          tags: Array<string>;
          ownerName?: string | null;
          ownerContact?: string | null;
          team?: string | null;
          domain?: string | null;
          environment?: string | null;
          slo?: string | null;
        };
      }>;
      eventSources: Array<{
        id: string;
        eventType: string;
        eventSource?: string | null;
      }>;
    };
    edges: {
      triggerToWorkflow: Array<({
        kind: 'event-trigger' | 'definition-trigger';
        triggerId: string;
        workflowId: string;
      } | {
        kind: 'schedule';
        scheduleId: string;
        workflowId: string;
      })>;
      workflowToStep: Array<{
        workflowId: string;
        fromStepId?: string | null;
        toStepId: string;
      }>;
      stepToAsset: Array<{
        workflowId: string;
        stepId: string;
        assetId: string;
        normalizedAssetId: string;
        direction: 'produces' | 'consumes';
        freshness?: any | null;
        partitioning?: (({
          type: 'timeWindow';
          granularity: 'minute' | 'hour' | 'day' | 'week' | 'month';
          timezone?: string | null;
          format?: string | null;
          lookbackWindows?: number | null;
        } | {
          type: 'static';
          keys: Array<string>;
        } | {
          type: 'dynamic';
          maxKeys?: number | null;
          retentionDays?: number | null;
        }) | null);
        autoMaterialize?: any | null;
      }>;
      assetToWorkflow: Array<{
        assetId: string;
        normalizedAssetId: string;
        workflowId: string;
        stepId?: string | null;
        reason: 'auto-materialize';
        priority?: number | null;
      }>;
      eventSourceToTrigger: Array<{
        sourceId: string;
        triggerId: string;
      }>;
      stepToEventSource: Array<{
        workflowId: string;
        stepId: string;
        sourceId: string;
        kind: 'inferred';
        confidence: {
          sampleCount: number;
          lastSeenAt: string;
        };
      }>;
    };
  };
  meta?: {
    cache: {
      hit: boolean;
      cachedAt?: string | null;
      ageMs?: number | null;
      expiresAt?: string | null;
      stats: {
        hits: number;
        misses: number;
        invalidations: number;
      };
      lastInvalidatedAt?: string | null;
      lastInvalidationReason?: string | null;
    };
  };
};

