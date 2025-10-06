import { defineModuleSecurity } from '@apphub/module-toolkit';
import type { ObservatorySecrets } from './settings';

export const security = defineModuleSecurity<ObservatorySecrets>({
  principals: {
    timestoreLoader: {
      subject: 'observatory-timestore-loader',
      description: 'Loads minute drops into Timestore'
    },
    dashboardAggregator: {
      subject: 'observatory-dashboard-aggregator',
      description: 'Builds dashboard aggregates'
    }
  },
  secrets: {
    timestoreToken: {
      select: (secrets) => secrets.timestoreToken,
      required: false,
      description: 'Token used by jobs to authenticate with Timestore'
    }
  }
});

export const PRINCIPALS = security.listPrincipals();
export const SECRETS = security.listSecrets();
