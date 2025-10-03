import { defineModule } from '@apphub/module-sdk';
import type {
  CapabilityValueReference,
  CapabilityValueTemplate
} from '@apphub/module-sdk';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from './src/runtime/settings';
import { defaultObservatorySettings } from './src/runtime/settings';
import { dataGeneratorJob } from './src/jobs/dataGenerator';
import { inboxNormalizerJob } from './src/jobs/inboxNormalizer';
import { timestoreLoaderJob } from './src/jobs/timestoreLoader';
import { visualizationRunnerJob } from './src/jobs/visualizationRunner';
import { dashboardAggregatorJob } from './src/jobs/dashboardAggregator';
import { reportPublisherJob } from './src/jobs/reportPublisher';
import { calibrationImporterJob } from './src/jobs/calibrationImporter';
import { calibrationPlannerJob } from './src/jobs/calibrationPlanner';
import { calibrationReprocessorJob } from './src/jobs/calibrationReprocessor';
import { dashboardService, adminService } from './src/services';
import {
  minuteDataGeneratorWorkflow,
  minuteIngestWorkflow,
  dailyPublicationWorkflow,
  dashboardAggregateWorkflow,
  calibrationImportWorkflow,
  calibrationReprocessWorkflow
} from './src/workflows';

type RefOptions<T> = {
  fallback?: CapabilityValueTemplate<T>;
  optional?: boolean;
};

function settingsRef<T>(path: string, options: RefOptions<T> = {}): CapabilityValueReference<T> {
  const reference: CapabilityValueReference<T> = {
    $ref: `settings.${path}`
  };
  if (options.fallback !== undefined) {
    reference.fallback = options.fallback;
  }
  if (options.optional) {
    reference.optional = true;
  }
  return reference;
}

function secretsRef<T>(path: string, options: RefOptions<T> = {}): CapabilityValueReference<T> {
  const reference: CapabilityValueReference<T> = {
    $ref: `secrets.${path}`
  };
  if (options.fallback !== undefined) {
    reference.fallback = options.fallback;
  }
  if (options.optional === undefined || options.optional) {
    reference.optional = true;
  }
  return reference;
}

export default defineModule<ObservatoryModuleSettings, ObservatoryModuleSecrets>({
  metadata: {
    name: 'environmental-observatory',
    version: '0.1.5',
    displayName: 'Environmental Observatory',
    description:
      'Reference implementation of the environmental observatory scenario using the AppHub module runtime.'
  },
  settings: {
    defaults: defaultObservatorySettings
  },
  secrets: {
    defaults: {}
  },
  capabilities: {
    filestore: {
      baseUrl: settingsRef('filestore.baseUrl'),
      backendMountId: settingsRef('filestore.backendId', { fallback: 1 }),
      token: secretsRef('filestoreToken')
    },
    metastore: {
      baseUrl: settingsRef('metastore.baseUrl'),
      namespace: settingsRef('metastore.namespace'),
      token: secretsRef('metastoreToken')
    },
    timestore: {
      baseUrl: settingsRef('timestore.baseUrl'),
      token: secretsRef('timestoreToken')
    },
    events: {
      baseUrl: settingsRef('core.baseUrl'),
      defaultSource: settingsRef('events.source'),
      token: secretsRef('eventsToken')
    },
    coreHttp: {
      baseUrl: settingsRef('core.baseUrl'),
      token: secretsRef('coreApiToken')
    },
    coreWorkflows: {
      baseUrl: settingsRef('core.baseUrl'),
      token: secretsRef('coreApiToken')
    }
  },
  targets: [
    dataGeneratorJob,
    inboxNormalizerJob,
    timestoreLoaderJob,
    visualizationRunnerJob,
    dashboardAggregatorJob,
    reportPublisherJob,
    calibrationImporterJob,
    calibrationPlannerJob,
    calibrationReprocessorJob,
    dashboardService,
    adminService,
    minuteDataGeneratorWorkflow,
    minuteIngestWorkflow,
    dailyPublicationWorkflow,
    dashboardAggregateWorkflow,
    calibrationImportWorkflow,
    calibrationReprocessWorkflow
  ]
});
