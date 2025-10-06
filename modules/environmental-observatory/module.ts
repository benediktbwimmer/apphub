import { defineModule, namedCapabilities, secretsRef, settingsRef } from '@apphub/module-sdk';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from './src/runtime/settings';
import { defaultObservatorySettings, defaultObservatorySecrets } from './src/runtime/settings';
import { dataGeneratorJob } from './src/jobs/dataGenerator';
import { minutePreprocessorJob } from './src/jobs/minutePreprocessor';
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

export default defineModule<ObservatoryModuleSettings, ObservatoryModuleSecrets>({
    metadata: {
      name: 'environmental-observatory',
      version: '0.1.9',
    displayName: 'Environmental Observatory',
    description:
      'Reference implementation of the environmental observatory scenario using the AppHub module runtime.'
  },
  settings: {
    defaults: defaultObservatorySettings
  },
  secrets: {
    defaults: defaultObservatorySecrets
  },
  capabilities: {
    filestore: {
      baseUrl: settingsRef('filestore.baseUrl'),
      backendMountId: settingsRef('filestore.backendId', { fallback: 1 }),
      token: secretsRef('filestoreToken')
    },
    metastore: namedCapabilities({
      reports: {
        baseUrl: settingsRef('metastore.baseUrl'),
        namespace: settingsRef('metastore.namespace'),
        token: secretsRef('metastoreToken')
      },
      calibrations: {
        baseUrl: settingsRef('calibrations.baseUrl', { fallback: settingsRef('metastore.baseUrl') }),
        namespace: settingsRef('calibrations.namespace'),
        token: secretsRef('calibrationsToken', {
          optional: true,
          fallback: secretsRef('metastoreToken')
        })
      }
    }),
    timestore: {
      baseUrl: settingsRef('timestore.baseUrl'),
      token: secretsRef('timestoreToken')
    },
    events: namedCapabilities({
      default: {
        baseUrl: settingsRef('core.baseUrl'),
        defaultSource: settingsRef('events.source'),
        token: secretsRef('eventsToken')
      },
      audit: {
        baseUrl: settingsRef('core.baseUrl'),
        defaultSource: 'observatory.audit',
        token: secretsRef('eventsToken', { optional: true })
      }
    }),
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
    minutePreprocessorJob,
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
