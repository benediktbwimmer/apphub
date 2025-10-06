import { COMMON_ENV_PRESET_KEYS } from '../common';

export const MODULE_PRESET_KEYS = {
  observatory: {
    core: [
      COMMON_ENV_PRESET_KEYS.filestore,
      COMMON_ENV_PRESET_KEYS.timestore,
      COMMON_ENV_PRESET_KEYS.metastore,
      COMMON_ENV_PRESET_KEYS.calibrations,
      COMMON_ENV_PRESET_KEYS.events,
      COMMON_ENV_PRESET_KEYS.dashboard,
      COMMON_ENV_PRESET_KEYS.core
    ],
    workflows: [COMMON_ENV_PRESET_KEYS.reprocess, COMMON_ENV_PRESET_KEYS.ingest],
    generator: [COMMON_ENV_PRESET_KEYS.generator],
    secrets: [COMMON_ENV_PRESET_KEYS.standardSecrets]
  }
} as const;
