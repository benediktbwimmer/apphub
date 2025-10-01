import {
  createJobHandler,
  defineModule,
  createModuleContext,
  type JobContext,
  type ModuleCapabilityOverrides
} from '..';

type GeneratorSettings = {
  minute: string;
  rows: number;
};

type GeneratorSecrets = {
  token?: string;
};

const generatorJob = createJobHandler<GeneratorSettings, GeneratorSecrets>({
  name: 'generator',
  description: 'Generate observatory files',
  handler: async (context: JobContext<GeneratorSettings, GeneratorSecrets>) => {
    context.logger.info('Running generator', { minute: context.settings.minute });
    context.settings.rows.toFixed(0);
    context.secrets.token?.toString();

    context.capabilities.filestore?.ensureDirectory({ path: 'datasets' });

    // @ts-expect-error missing property on settings
    context.settings.unknown;
  },
  capabilityOverrides: {
    filestore: (config, createDefault) => {
      const fallback = createDefault();
      return fallback ?? undefined;
    }
  }
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
  targets: [generatorJob]
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

const overrides: ModuleCapabilityOverrides = {
  filestore: null
};

void context;
void overrides;
