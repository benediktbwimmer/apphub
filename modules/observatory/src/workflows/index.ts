import { createTargetRegistryFromArray } from '@apphub/module-toolkit';
import { minuteDataGeneratorWorkflow } from './minuteDataGenerator';
import { minuteIngestWorkflow } from './minuteIngest';
import { dailyPublicationWorkflow } from './dailyPublication';
import { dashboardAggregateWorkflow } from './dashboardAggregate';
import { calibrationImportWorkflow } from './calibrationImport';
import { calibrationReprocessWorkflow } from './calibrationReprocess';

export const workflows = createTargetRegistryFromArray([
  minuteDataGeneratorWorkflow,
  minuteIngestWorkflow,
  dailyPublicationWorkflow,
  dashboardAggregateWorkflow,
  calibrationImportWorkflow,
  calibrationReprocessWorkflow
]);

export {
  minuteDataGeneratorWorkflow,
  minuteIngestWorkflow,
  dailyPublicationWorkflow,
  dashboardAggregateWorkflow,
  calibrationImportWorkflow,
  calibrationReprocessWorkflow
};
