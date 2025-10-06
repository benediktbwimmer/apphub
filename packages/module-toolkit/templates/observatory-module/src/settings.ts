import { z } from 'zod';
import {
  createModuleSettingsDefinition,
  COMMON_ENV_PRESET_KEYS
} from '@apphub/module-toolkit';

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

const DEFAULT_SETTINGS: ObservatorySettings = {
  timestore: {
    baseUrl: 'http://127.0.0.1:4200',
    datasetSlug: 'observatory-timeseries'
  },
  filestore: {
    baseUrl: 'http://127.0.0.1:4300',
    inboxPrefix: 'datasets/observatory/raw'
  }
};

const DEFAULT_SECRETS: ObservatorySecrets = {
  timestoreToken: undefined
};

const settingsDefinition = createModuleSettingsDefinition({
  settingsSchema: ObservatorySettingsSchema,
  secretsSchema: ObservatorySecretsSchema,
  defaults: () => DEFAULT_SETTINGS,
  secretsDefaults: () => DEFAULT_SECRETS,
  envPresetKeys: [
    COMMON_ENV_PRESET_KEYS.timestore,
    COMMON_ENV_PRESET_KEYS.filestore
  ],
  secretsEnvPresetKeys: [COMMON_ENV_PRESET_KEYS.standardSecrets]
});

export const loadSettings = settingsDefinition.load;
export const defaultSettings = settingsDefinition.defaultSettings;
export const defaultSecrets = settingsDefinition.defaultSecrets;
