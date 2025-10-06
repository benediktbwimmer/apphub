import {
  defineJobParameters,
  createJobRegistry,
  fromConfig,
  literal
} from '@apphub/module-toolkit';
import type { ObservatorySettings, ObservatorySecrets } from '../settings';
import { security } from '../security';

const timestoreLoaderJob = defineJobParameters<ObservatorySettings>({
  slug: 'observatory.timestore-loader',
  parameters: {
    timestoreBaseUrl: fromConfig((settings) => settings.timestore.baseUrl),
    datasetSlug: fromConfig((settings) => settings.timestore.datasetSlug),
    filestoreBaseUrl: fromConfig((settings) => settings.filestore.baseUrl),
    principal: security.principal('timestoreLoader').asValueBuilder(),
    jobName: literal('observatory-timestore-loader')
  }
});

export const jobs = createJobRegistry({
  'observatory.timestore-loader': timestoreLoaderJob
});
