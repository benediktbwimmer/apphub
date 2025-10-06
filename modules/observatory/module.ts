import {
  defineModule,
  namedCapabilities,
  secretsRef,
  settingsRef
} from '@apphub/module-sdk';
import type { ObservatorySettings, ObservatorySecrets } from './src/config/settings';
import {
  defaultSettings,
  defaultSecrets,
  resolveSettingsFromRaw,
  resolveSecretsFromRaw
} from './src/config/settings';
import { security } from './src/config/security';
import {
  dataGeneratorJob,
  minutePreprocessorJob,
  timestoreLoaderJob,
  visualizationRunnerJob,
  dashboardAggregatorJob,
  reportPublisherJob,
  calibrationImporterJob,
  calibrationPlannerJob,
  calibrationReprocessorJob
} from './src/jobs';
import { dashboardService, adminService } from './src/services';
import {
  minuteDataGeneratorWorkflow,
  minuteIngestWorkflow,
  dailyPublicationWorkflow,
  dashboardAggregateWorkflow,
  calibrationImportWorkflow,
  calibrationReprocessWorkflow
} from './src/workflows';

export default defineModule<ObservatorySettings, ObservatorySecrets>({
  metadata: {
    name: 'observatory',
    version: '0.2.0',
    displayName: 'Observatory Module',
    description:
      'Next generation environmental observatory scenario built with the AppHub module toolkit.'
  },
  settings: {
    resolve: (raw) => {
      return resolveSettingsFromRaw(raw);
    }
  },
  secrets: {
    resolve: (raw) => {
      return resolveSecretsFromRaw(raw);
    }
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
