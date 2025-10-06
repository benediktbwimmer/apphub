import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createSettingsLoader } from '../src/index';

describe('createSettingsLoader', () => {
  test('parses environment into typed settings and secrets', () => {
    const settingsSchema = z.object({
      datasetSlug: z.string(),
      maxFiles: z.coerce.number()
    });
    const secretsSchema = z.object({
      apiToken: z.string().optional()
    });

    const loader = createSettingsLoader({
      settingsSchema,
      secretsSchema,
      readSettings: (env) => ({
        datasetSlug: env.DATASET_SLUG,
        maxFiles: env.MAX_FILES
      }),
      readSecrets: (env) => ({
        apiToken: env.API_TOKEN
      })
    });

    const result = loader({
      env: {
        DATASET_SLUG: 'observatory-timeseries',
        MAX_FILES: '200'
      },
      secretsEnv: {
        API_TOKEN: 'secret-token'
      }
    });

    expect(result.settings.datasetSlug).toBe('observatory-timeseries');
    expect(result.settings.maxFiles).toBe(200);
    expect(result.secrets?.apiToken).toBe('secret-token');
  });
});
