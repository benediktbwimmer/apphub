import { z } from 'zod';
import { createSettingsLoader } from '@apphub/module-toolkit';

export const ObservatorySettingsSchema = z.object({
  timestore: z.object({
    baseUrl: z.string().url(),
    datasetSlug: z.string()
  }),
  filestore: z.object({
    baseUrl: z.string().url(),
    inboxPrefix: z.string()
  })
});

export const ObservatorySecretsSchema = z.object({
  timestoreToken: z.string().optional()
});

export type ObservatorySettings = z.infer<typeof ObservatorySettingsSchema>;
export type ObservatorySecrets = z.infer<typeof ObservatorySecretsSchema>;

export const loadSettings = createSettingsLoader({
  settingsSchema: ObservatorySettingsSchema,
  secretsSchema: ObservatorySecretsSchema,
  readSettings: (env) => ({
    timestore: {
      baseUrl: env.OBSERVATORY_TIMESTORE_BASE_URL ?? 'http://127.0.0.1:4200',
      datasetSlug: env.OBSERVATORY_TIMESTORE_DATASET_SLUG ?? 'observatory-timeseries'
    },
    filestore: {
      baseUrl: env.OBSERVATORY_FILESTORE_BASE_URL ?? 'http://127.0.0.1:4300',
      inboxPrefix: env.OBSERVATORY_FILESTORE_INBOX_PREFIX ?? 'datasets/observatory/raw'
    }
  }),
  readSecrets: (env) => ({
    timestoreToken: env.OBSERVATORY_TIMESTORE_TOKEN
  })
});
