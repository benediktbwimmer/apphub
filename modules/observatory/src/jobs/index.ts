import { createTargetRegistryFromArray } from '@apphub/module-toolkit';
import { dataGeneratorJob } from './dataGenerator';
import { minutePreprocessorJob } from './minutePreprocessor';
import { timestoreLoaderJob } from './timestoreLoader';
import { visualizationRunnerJob } from './visualizationRunner';
import { dashboardAggregatorJob } from './dashboardAggregator';
import { reportPublisherJob } from './reportPublisher';
import { calibrationImporterJob } from './calibrationImporter';
import { calibrationPlannerJob } from './calibrationPlanner';
import { calibrationReprocessorJob } from './calibrationReprocessor';

export const jobs = createTargetRegistryFromArray([
  dataGeneratorJob,
  minutePreprocessorJob,
  timestoreLoaderJob,
  visualizationRunnerJob,
  dashboardAggregatorJob,
  reportPublisherJob,
  calibrationImporterJob,
  calibrationPlannerJob,
  calibrationReprocessorJob
]);

export {
  dataGeneratorJob,
  minutePreprocessorJob,
  timestoreLoaderJob,
  visualizationRunnerJob,
  dashboardAggregatorJob,
  reportPublisherJob,
  calibrationImporterJob,
  calibrationPlannerJob,
  calibrationReprocessorJob
};
