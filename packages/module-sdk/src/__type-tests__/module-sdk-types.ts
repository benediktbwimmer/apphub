import {
  createJobHandler,
  createService,
  createWorkflow,
  createWorkflowSchedule,
  createWorkflowTrigger,
  defineModule,
  createModuleContext,
  createJobContext,
  type JobContext,
  type ModuleCapabilityOverrides,
  type ServiceContext
} from '..';

type GeneratorSettings = {
  minute: string;
  rows: number;
};

type GeneratorSecrets = {
  token?: string;
};

type GeneratorParameters = {
  minute: string;
};

const generatorJob = createJobHandler<GeneratorSettings, GeneratorSecrets, void, GeneratorParameters>({
  name: 'generator',
  description: 'Generate observatory files',
  parameters: {
    defaults: {
      minute: '2023-01-01T00:00'
    }
  },
  handler: async (
    context: JobContext<GeneratorSettings, GeneratorSecrets, GeneratorParameters>
  ) => {
    context.logger.info('Running generator', { minute: context.settings.minute });
    context.settings.rows.toFixed(0);
    context.secrets.token?.toString();

    context.job.version.toUpperCase();

    context.capabilities.filestore?.ensureDirectory({ path: 'datasets' });

    context.parameters.minute.toUpperCase();

    // @ts-expect-error missing property on settings
    context.settings.unknown;

    // @ts-expect-error missing property on parameters
    context.parameters.unknown;
  },
  capabilityOverrides: {
    filestore: (config, createDefault) => {
      const fallback = createDefault();
      return fallback ?? undefined;
    }
  }
});

const dashboardService = createService<GeneratorSettings, GeneratorSecrets, { start: () => Promise<void> }>(
  {
    name: 'dashboard',
    handler: async (context: ServiceContext<GeneratorSettings, GeneratorSecrets>) => {
      await context.capabilities.filestore?.ensureDirectory({ path: 'services' });
      return {
        async start() {
          context.logger.info('starting service');
        }
      };
    }
  }
);

const aggregateWorkflow = createWorkflow<GeneratorSettings, GeneratorSecrets>({
  name: 'observatory-dashboard-aggregate',
  description: 'Aggregate observatory metrics',
  definition: {
    slug: 'observatory-dashboard-aggregate',
    steps: []
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
      ],
      throttle: {
        windowMs: 60000,
        count: 5
      }
    }),
    {
      name: 'fallback',
      eventType: 'observatory.minute.raw-uploaded',
      metadata: { priority: 'low' }
    }
  ],
  schedules: [
    createWorkflowSchedule({
      name: 'hourly-backfill',
      cron: '0 * * * *',
      timezone: 'UTC',
      enabled: true
    }),
    {
      name: 'daily-maintenance',
      cron: '0 6 * * *'
    }
  ]
});

const moduleDefinition = defineModule<GeneratorSettings, GeneratorSecrets>({
  metadata: {
    name: 'observatory-module',
    version: '0.1.0'
  },
  settings: {
    defaults: {
      minute: '2023-01-01T00:00',
      rows: 10
    }
  },
  secrets: {
    defaults: {}
  },
  capabilities: {},
  targets: [generatorJob, dashboardService, aggregateWorkflow]
});

const context = createModuleContext<GeneratorSettings, GeneratorSecrets>({
  module: moduleDefinition.metadata,
  settingsDescriptor: moduleDefinition.settings,
  secretsDescriptor: moduleDefinition.secrets,
  capabilityConfig: moduleDefinition.capabilities,
  settings: {
    minute: '2023-01-02T00:00',
    rows: 12
  }
});

const jobContext = createJobContext<GeneratorSettings, GeneratorSecrets, GeneratorParameters>({
  module: moduleDefinition.metadata,
  job: {
    name: generatorJob.name
  },
  settingsDescriptor: moduleDefinition.settings,
  secretsDescriptor: moduleDefinition.secrets,
  capabilityConfig: moduleDefinition.capabilities,
  parametersDescriptor: generatorJob.parameters,
  parameters: {
    minute: '2023-01-03T00:00'
  }
});

context.module.version.toUpperCase();
jobContext.job.version.toUpperCase();

const overrides: ModuleCapabilityOverrides = {
  filestore: null
};

void context;
void jobContext;
void overrides;
