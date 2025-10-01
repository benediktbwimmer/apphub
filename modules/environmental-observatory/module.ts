import { defineModule } from '@apphub/module-sdk';
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

export default defineModule<ObservatoryModuleSettings, ObservatoryModuleSecrets>({
  metadata: {
    name: 'environmental-observatory',
    version: '0.1.0',
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
