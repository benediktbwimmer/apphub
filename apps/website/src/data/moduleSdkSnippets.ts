export type ModuleSdkSnippet = {
  id: string;
  title: string;
  description: string;
  language?: string;
  highlightLines?: number[];
  code: string;
  tags: string[];
  category: 'module' | 'jobs' | 'services' | 'capabilities' | 'workflows' | 'assets';
};

export const moduleSdkSnippets: ModuleSdkSnippet[] = [
  {
    id: 'module-definition',
    title: 'Define a module with imported targets',
    description:
      'Keep module metadata, capability wiring, and target registration in one place while jobs and workflows live beside each other.',
    language: 'typescript',
    highlightLines: [1, 13, 28, 48],
    tags: ['module', 'definition', 'targets'],
    category: 'module',
    code: String.raw`import { defineModule } from '@apphub/module-sdk';
import {
  ingestMinuteJob,
  aggregateHourJob,
  publishDashboardJob
} from './targets/jobs';
import {
  ingestToTimestoreWorkflow,
  hourlyAggregationWorkflow,
  dashboardPublishingWorkflow
} from './targets/workflows';

export default defineModule({
  metadata: {
    name: 'environmental-observatory',
    version: '0.7.0',
    displayName: 'Environmental Observatory'
  },
  settings: {
    defaults: {
      ingestPrefix: 'observatory/minute',
      dashboardSlug: 'observatory-dashboard'
    }
  },
  secrets: {
    defaults: {}
  },
  capabilities: {
    filestore: {
      baseUrl: { $ref: 'settings.filestore.baseUrl' },
      backendMountId: { $ref: 'settings.filestore.mountId', fallback: 1 }
    },
    timestore: {
      baseUrl: { $ref: 'settings.timestore.baseUrl' },
      token: { $ref: 'secrets.timestoreToken' }
    },
    metastore: {
      baseUrl: { $ref: 'settings.metastore.baseUrl' },
      namespace: { $ref: 'settings.metastore.namespace' },
      token: { $ref: 'secrets.metastoreToken', optional: true }
    },
    events: {
      baseUrl: { $ref: 'settings.core.baseUrl' },
      defaultSource: { $ref: 'settings.events.source', fallback: 'observatory.module' },
      token: { $ref: 'secrets.eventsToken', optional: true }
    }
  },
  targets: [
    ingestMinuteJob,
    aggregateHourJob,
    publishDashboardJob,
    ingestToTimestoreWorkflow,
    hourlyAggregationWorkflow,
    dashboardPublishingWorkflow
  ]
});`
  },
  {
    id: 'filestore-ensure-directory',
    title: 'Create directories in Filestore',
    description: 'Use the filestore capability to create a namespaced directory before uploading artefacts.',
    language: 'typescript',
    highlightLines: [7, 10],
    tags: ['filestore'],
    category: 'jobs',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

export const ensureIngestDirectory = createJobHandler({
  name: 'ensure-filestore-directory',
  handler: async (ctx) => {
    const mount = ctx.parameters.mount ?? 'observatory-data';
    const path = \`datasets/\${ctx.parameters.dataset}/\${ctx.parameters.minute}\`;

    await ctx.capabilities.filestore?.ensureDirectory({
      mount,
      path
    });
  }
});`
  },
  {
    id: 'event-bus-publish',
    title: 'Emit custom events',
    description: 'Publish domain-specific events back into the AppHub event bus from module code.',
    language: 'typescript',
    highlightLines: [11],
    tags: ['event-bus'],
    category: 'jobs',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

export const alertOnAnomaly = createJobHandler({
  name: 'observatory-anomaly-alert',
  handler: async (ctx) => {
    const payload = {
      siteId: ctx.parameters.siteId,
      minute: ctx.parameters.minute,
      score: ctx.parameters.score
    };

    await ctx.capabilities.eventBus?.publish({
      type: 'observatory.anomaly.detected',
      source: 'observatory.analytics',
      payload,
      correlationId: ctx.runId
    });
  }
});`
  },
  {
    id: 'job-with-secrets',
    title: 'Guard secrets with a resolver',
    description: 'Coerce raw secrets into typed values and block execution until mandatory keys are present.',
    language: 'typescript',
    highlightLines: [9, 13, 19],
    tags: ['jobs', 'secrets'],
    category: 'jobs',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

type ForwarderSettings = {
  partnerEndpoint: string;
};

type ForwarderSecrets = {
  ingestToken: string;
  grafanaApiKey?: string;
};

export const pushToPartner = createJobHandler<ForwarderSettings, ForwarderSecrets>({
  name: 'observatory-partner-forwarder',
  secrets: {
    resolve(raw) {
      const input = (raw ?? {}) as Partial<ForwarderSecrets>;
      if (!input.ingestToken) {
        throw new Error('Missing ingestToken secret for partner forwarding.');
      }
      return {
        ingestToken: String(input.ingestToken),
        grafanaApiKey: input.grafanaApiKey ? String(input.grafanaApiKey) : undefined
      };
    }
  },
  handler: async (ctx) => {
    const endpoint = ctx.settings.partnerEndpoint.replace(/\/$/, '') + '/events';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + ctx.secrets.ingestToken,
        'content-type': 'application/json'
      },
      body: JSON.stringify(ctx.parameters.eventPayload)
    });

    if (!response.ok) {
      throw new Error('Forwarding failed with status ' + response.status);
    }
  }
});`
  },
  {
    id: 'timestore-sql-query',
    title: 'Query timestore partitions via SQL',
    description: 'Call the timestore capability from a job or service to run ANSI SQL against Parquet partitions.',
    language: 'typescript',
    highlightLines: [9, 16],
    tags: ['timestore', 'sql'],
    category: 'capabilities',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

export const summarizeReadings = createJobHandler({
  name: 'observatory-summary-query',
  handler: async (ctx) => {
    const sql = \`SELECT
      minute,
      avg(temperature) AS avg_temperature,
      max(temperature) AS max_temperature
    FROM observatory_minute
    WHERE site_id = @siteId
    GROUP BY minute
    ORDER BY minute DESC
    LIMIT 120\`;

    const rows = await ctx.capabilities.timestore?.query({
      sql,
      parameters: { siteId: ctx.parameters.siteId }
    });

    return { status: 'succeeded', result: { rows } };
  }
});`
  },
  {
    id: 'dashboard-service',
    title: 'Register a dashboard service',
    description: 'Expose a Fastify-powered UI with health checks and filestore-backed report streaming.',
    language: 'typescript',
    highlightLines: [1, 12, 26, 42],
    tags: ['services', 'fastify', 'filestore'],
    category: 'services',
    code: String.raw`import { createService, type ServiceLifecycle } from '@apphub/module-sdk';
import Fastify from 'fastify';

type ObservatorySettings = {
  filestore: { backendMountId: number };
  dashboard: { port: number };
  principals: { dashboardAggregator: string };
};

export const dashboardService = createService<
  ObservatorySettings,
  Record<string, never>,
  ServiceLifecycle
>({
  name: 'observatory-dashboard-service',
  registration: {
    slug: 'observatory-dashboard',
    kind: 'dashboard',
    healthEndpoint: '/healthz',
    defaultPort: 4311,
    basePath: '/',
    tags: ['dashboard', 'ui'],
    ui: { previewPath: '/', spa: true }
  },
  handler: (ctx) => {
    const app = Fastify({ logger: false });

    app.get('/healthz', async () => ({
      status: 'ok',
      moduleVersion: ctx.module.version
    }));

    app.get('/reports/:partition', async (request, reply) => {
      const filestore = ctx.capabilities.filestore;
      if (!filestore) {
        reply.code(503).send({ error: 'Filestore unavailable' });
        return;
      }

      const params = request.params as { partition: string };
      const node = await filestore.getNodeByPath({
        backendMountId: ctx.settings.filestore.backendMountId,
        path: 'reports/' + params.partition + '.json',
        principal: ctx.settings.principals.dashboardAggregator
      });

      const download = await filestore.downloadFile({
        nodeId: node.id,
        principal: ctx.settings.principals.dashboardAggregator
      });

      reply.header('content-type', download.mediaType ?? 'application/json');
      reply.send(download.stream);
    });

    return {
      async start() {
        const port = Number(process.env.PORT ?? ctx.settings.dashboard.port ?? 4311);
        await app.listen({ host: '0.0.0.0', port });
      },
      async stop() {
        await app.close();
      }
    } satisfies ServiceLifecycle;
  }
});`
  },
  {
    id: 'metastore-upsert',
    title: 'Persist configuration with Metastore',
    description: 'Upsert a configuration document with optimistic concurrency guarantees.',
    language: 'typescript',
    highlightLines: [14],
    tags: ['metastore', 'configuration'],
    category: 'capabilities',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

export const upsertThresholds = createJobHandler({
  name: 'observatory-threshold-upsert',
  handler: async (ctx) => {
    const namespace = 'observatory.thresholds';
    const key = ctx.parameters.siteId;

    await ctx.capabilities.metastore?.upsertRecord({
      namespace,
      key,
      record: {
        ...ctx.parameters.thresholds,
        updatedAt: new Date().toISOString()
      }
    });
  }
});`
  },
  {
    id: 'capability-overrides',
    title: 'Instrument capability overrides',
    description: 'Wrap built-in capabilities to add metrics or feature flags without forking the SDK.',
    language: 'typescript',
    highlightLines: [1, 14, 18, 29],
    tags: ['capabilities', 'overrides', 'observability'],
    category: 'capabilities',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

type IngestSettings = {
  timestore: { dataset: string };
};

type IngestSecrets = {
  timestoreToken?: string;
};

export const ingestMinuteWithMetrics = createJobHandler<
  IngestSettings,
  IngestSecrets,
  unknown,
  { records: unknown[] }
>({
  name: 'observatory-minute-ingest',
  capabilityOverrides: {
    timestore: (config, createDefault) => {
      const base = createDefault();
      if (!base) {
        return undefined;
      }
      return {
        ...base,
        async ingestRecords(input) {
          const started = Date.now();
          const result = await base.ingestRecords(input);
          const elapsed = Date.now() - started;
          console.log('Ingested ' + (input.records?.length ?? 0) + ' rows in ' + elapsed + 'ms');
          return result;
        }
      };
    }
  },
  handler: async (ctx) => {
    await ctx.capabilities.timestore?.ingestRecords({
      dataset: ctx.settings.timestore.dataset,
      records: ctx.parameters.records
    });
  }
});`
  },
  {
    id: 'workflow-with-triggers',
    title: 'Respond to events with workflow triggers',
    description: 'Declare a workflow that reacts whenever a new timestore partition is ready.',
    language: 'typescript',
    highlightLines: [1, 12, 16],
    tags: ['workflows', 'triggers'],
    category: 'workflows',
    code: String.raw`import { createWorkflow, createWorkflowTrigger } from '@apphub/module-sdk';

export const materializeWorkflow = createWorkflow({
  name: 'observatory-materialize',
  definition: {
    slug: 'observatory-materialize',
    steps: [
      {
        id: 'refresh-dataset',
        jobSlug: 'observatory-minute-ingest'
      }
    ]
  },
  triggers: [
    createWorkflowTrigger({
      name: 'minute-ready',
      eventType: 'observatory.ingest.completed',
      predicates: [
        { path: 'payload.minute', operator: 'exists' }
      ]
    })
  ]
});`
  },
  {
    id: 'workflow-with-schedule',
    title: 'Schedule recurring workflows',
    description: 'Run nightly maintenance workflows using `createWorkflowSchedule`.',
    language: 'typescript',
    highlightLines: [1, 13, 19],
    tags: ['workflows', 'schedules'],
    category: 'workflows',
    code: String.raw`import { createWorkflow, createWorkflowSchedule } from '@apphub/module-sdk';

export const nightlyReconciliation = createWorkflow({
  name: 'observatory-nightly-reconciliation',
  definition: {
    slug: 'observatory-nightly-reconciliation',
    steps: [
      {
        id: 'reconcile-hashes',
        jobSlug: 'observatory-hash-reconciliation'
      }
    ]
  },
  schedules: [
    createWorkflowSchedule({
      name: 'nightly',
      cron: '0 3 * * *',
      timezone: 'UTC',
      enabled: true
    })
  ]
});`
  },
  {
    id: 'workflow-triggers-and-schedules',
    title: 'Blend triggers and schedules',
    description: 'Combine event triggers with cron schedules for resilient workflows.',
    language: 'typescript',
    highlightLines: [12, 24],
    tags: ['workflows', 'triggers', 'schedules'],
    category: 'workflows',
    code: String.raw`import {
  createWorkflow,
  createWorkflowTrigger,
  createWorkflowSchedule
} from '@apphub/module-sdk';

export const aggregateMetrics = createWorkflow({
  name: 'observatory-dashboard-aggregate',
  definition: {
    slug: 'observatory-dashboard-aggregate',
    steps: [{ id: 'aggregate', jobSlug: 'observatory-dashboard-aggregate' }]
  },
  triggers: [
    createWorkflowTrigger({
      name: 'partition-ready',
      eventType: 'observatory.minute.partition-ready',
      predicates: [
        {
          path: 'payload.datasetSlug',
          operator: 'equals',
          value: 'observatory-timeseries'
        }
      ]
    })
  ],
  schedules: [
    createWorkflowSchedule({
      name: 'hourly-backfill',
      cron: '0 * * * *',
      timezone: 'UTC'
    })
  ]
});`
  },
  {
    id: 'workflow-completion-callback',
    title: 'Chain workflows on completion',
    description: 'Wait for an upstream workflow to succeed, then enqueue a follow-up run with recorded metadata.',
    language: 'typescript',
    highlightLines: [1, 18, 36, 52],
    tags: ['workflows', 'callbacks', 'core-workflows'],
    category: 'workflows',
    code: String.raw`import { createJobHandler, createWorkflow, createWorkflowTrigger } from '@apphub/module-sdk';

type WorkflowSettings = {
  principals: { observability: string };
};

type WorkflowSecrets = Record<string, never>;

export const awaitIngestCompletion = createJobHandler<
  WorkflowSettings,
  WorkflowSecrets,
  unknown,
  { runId: string; partitionKey: string }
>({
  name: 'observatory-await-ingest',
  handler: async (ctx) => {
    const coreWorkflows = ctx.capabilities.coreWorkflows;
    if (!coreWorkflows) {
      throw new Error('coreWorkflows capability required');
    }

    const response = await coreWorkflows.getWorkflowRun({
      runId: ctx.parameters.runId,
      principal: ctx.settings.principals.observability
    });

    const envelope = response && typeof response === 'object' ? response : {};
    const data = 'data' in envelope && envelope.data && typeof envelope.data === 'object'
      ? (envelope.data as Record<string, unknown>)
      : (envelope as Record<string, unknown>);
    const status = typeof data.status === 'string' ? data.status : 'pending';

    if (status !== 'succeeded') {
      throw new Error('Upstream workflow is still ' + status);
    }

    await coreWorkflows.enqueueWorkflowRun({
      workflowSlug: 'observatory-dashboard-refresh',
      partitionKey: ctx.parameters.partitionKey,
      triggeredBy: 'workflow:' + ctx.parameters.runId,
      metadata: {
        sourceRunId: ctx.parameters.runId
      }
    });
  }
});

export const dashboardRefreshWorkflow = createWorkflow<WorkflowSettings, WorkflowSecrets>({
  name: 'observatory-dashboard-refresh',
  definition: {
    slug: 'observatory-dashboard-refresh',
    steps: [
      {
        id: 'await-ingest',
        jobSlug: 'observatory-await-ingest'
      },
      {
        id: 'publish-dashboard',
        jobSlug: 'observatory-dashboard-publish'
      }
    ]
  },
  triggers: [
    createWorkflowTrigger({
      name: 'minute-ingest-complete',
      eventType: 'observatory.workflow.completed',
      predicates: [
        { path: 'payload.workflowSlug', operator: 'equals', value: 'observatory-minute-ingest' },
        { path: 'payload.status', operator: 'equals', value: 'succeeded' }
      ],
      parameterTemplate: {
        runId: '{{ event.payload.runId }}',
        partitionKey: '{{ event.payload.partitionKey }}'
      }
    })
  ]
});`
  },
  {
    id: 'asset-auto-materialize',
    title: 'Emit assets with auto-materialisation hints',
    description: 'Return assets from a job so downstream workflows refresh automatically when data changes.',
    language: 'typescript',
    highlightLines: [5, 9, 19],
    tags: ['assets', 'jobs'],
    category: 'assets',
    code: String.raw`import { createJobHandler } from '@apphub/module-sdk';

export const publishVisualizations = createJobHandler({
  name: 'observatory-visualizations',
  produces: [
    {
      assetId: 'observatory.visualizations.minute',
      autoMaterialize: { onUpstreamUpdate: true },
      freshness: { ttlMs: 15 * 60 * 1000 }
    }
  ],
  handler: async (ctx) => {
    const asset = {
      assetId: 'observatory.visualizations.minute',
      partitionKey: ctx.parameters.minute,
      payload: {
        plots: ctx.parameters.plots,
        generatedAt: new Date().toISOString()
      }
    };

    return {
      status: 'succeeded',
      result: {
        assets: [asset]
      }
    };
  }
});`
  }
];
