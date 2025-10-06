import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  createSettingsLoader,
  defineSettings,
  createEnvBindingPreset,
  createEnvSource,
  registerEnvBindingPreset,
  createModuleSettingsDefinition,
  defineModuleSecurity
} from '../src/index';

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

describe('defineSettings', () => {
  const settingsSchema = z.object({
    service: z.object({
      baseUrl: z.string().url(),
      retries: z.number().int()
    }),
    flags: z.object({ enableFeature: z.boolean() })
  });

  const secretsSchema = z.object({ token: z.string().optional() });

  registerEnvBindingPreset(
    'test.service.base',
    createEnvBindingPreset([
      { key: 'SERVICE_BASE_URL', path: 'service.baseUrl' },
      {
        key: 'SERVICE_RETRIES',
        path: 'service.retries',
        map: ({ value, current }) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : (current as number);
        }
      }
    ])
  );

  const definition = defineSettings({
    settingsSchema,
    secretsSchema,
    defaults: () => ({
      service: {
        baseUrl: 'http://localhost:3000',
        retries: 3
      },
      flags: {
        enableFeature: false
      }
    }),
    secretsDefaults: () => ({ token: undefined }),
    envBindingPresetKeys: ['test.service.base'],
    envBindings: [
      {
        key: 'ENABLE_FEATURE',
        path: 'flags.enableFeature',
        map: ({ value }) => value.toLowerCase() === 'true'
      }
    ],
    secretsEnvBindingPresets: [createEnvBindingPreset([{ key: 'SERVICE_TOKEN', path: 'token' }])],
    envSources: [createEnvSource(() => ({ values: { SERVICE_RETRIES: '4' }, mode: 'fill' }))]
  });

  test('load applies defaults, env bindings, and secrets', () => {
    const result = definition.load({
      env: {
        SERVICE_BASE_URL: 'https://api.example.com',
        SERVICE_RETRIES: '5',
        ENABLE_FEATURE: 'true'
      },
      secretsEnv: {
        SERVICE_TOKEN: 's3cr3t'
      }
    });

    expect(result.settings.service.baseUrl).toBe('https://api.example.com');
    expect(result.settings.service.retries).toBe(5);
    expect(result.settings.flags.enableFeature).toBe(true);
    expect(result.secrets?.token).toBe('s3cr3t');
  });

  test('envSources can backfill missing values before bindings apply', () => {
    const defaults = definition.defaultSettings();
    expect(defaults.service.retries).toBe(4);
  });

  test('resolveSettings merges overrides onto defaults', () => {
    const resolved = definition.resolveSettings({
      service: { retries: 10 }
    });

    expect(resolved.service.retries).toBe(10);
    expect(resolved.service.baseUrl).toBe('http://localhost:3000');
    expect(resolved.flags.enableFeature).toBe(false);
  });

  test('resolveSecrets removes keys when override is null or empty', () => {
    const base = definition.defaultSecrets();
    base.token = 'base-token';

    const merged = definition.mergeSecretsOverrides(base, {
      token: ''
    });

    expect(merged.token).toBeUndefined();
  });

  test('createModuleSettingsDefinition injects principal defaults', () => {
    const security = defineModuleSecurity<{ token?: string }>({
      principals: {
        worker: { subject: 'observatory-worker' }
      }
    });

    const schema = z.object({
      principals: z.object({
        worker: z.string()
      }),
      flags: z.object({
        enableFeature: z.boolean()
      })
    });

    const moduleDefinition = createModuleSettingsDefinition({
      settingsSchema: schema,
      defaults: () => ({
        principals: { worker: 'custom-worker' },
        flags: { enableFeature: false }
      }),
      security
    });

    const result = moduleDefinition.defaultSettings();
    expect(result.principals.worker).toBe('custom-worker');
  });
});
