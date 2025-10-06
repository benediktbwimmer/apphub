import { defineModuleSecurity } from '@apphub/module-toolkit';
import type { PrincipalDefinition, SecretDefinition } from '@apphub/module-toolkit';
import type { ObservatorySecrets } from './settings';

const PRINCIPAL_DEFINITIONS = {
  dataGenerator: {
    subject: 'observatory-data-generator',
    description: 'Generates synthetic telemetry CSVs.'
  },
  minutePreprocessor: {
      subject: 'observatory-minute-preprocessor',
      description: 'Normalizes raw uploads before ingest.'
    },
    timestoreLoader: {
      subject: 'observatory-timestore-loader'
    },
    visualizationRunner: {
      subject: 'observatory-visualization-runner'
    },
    dashboardAggregator: {
      subject: 'observatory-dashboard-aggregator'
    },
    calibrationImporter: {
      subject: 'observatory-calibration-importer'
    },
    calibrationPlanner: {
      subject: 'observatory-calibration-planner'
    },
    calibrationReprocessor: {
      subject: 'observatory-calibration-reprocessor'
    }
} satisfies Record<string, PrincipalDefinition>;

const SECRET_DEFINITIONS = {
  filestoreToken: {
    select: (secrets: ObservatorySecrets) => secrets.filestoreToken,
    required: false
  },
  timestoreToken: {
    select: (secrets: ObservatorySecrets) => secrets.timestoreToken,
    required: false
  },
  metastoreToken: {
    select: (secrets: ObservatorySecrets) => secrets.metastoreToken,
    required: false
  },
  calibrationsToken: {
    select: (secrets: ObservatorySecrets) => secrets.calibrationsToken,
    required: false
  },
  eventsToken: {
    select: (secrets: ObservatorySecrets) => secrets.eventsToken,
    required: false
  },
  coreApiToken: {
    select: (secrets: ObservatorySecrets) => secrets.coreApiToken,
    required: false
  }
} satisfies Record<string, SecretDefinition<ObservatorySecrets, string | undefined>>;

export const security = defineModuleSecurity<
  ObservatorySecrets,
  typeof PRINCIPAL_DEFINITIONS,
  typeof SECRET_DEFINITIONS
>({
  principals: PRINCIPAL_DEFINITIONS,
  secrets: SECRET_DEFINITIONS
});

export const PRINCIPALS = security.listPrincipals();
export const SECRETS = security.listSecrets();
