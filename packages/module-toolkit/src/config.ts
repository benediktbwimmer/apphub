import type { ZodTypeAny, infer as ZodInfer } from 'zod';

export interface SettingsLoaderOptions<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined
> {
  settingsSchema: TSettingsSchema;
  secretsSchema?: TSecretsSchema;
  readSettings?: (env: Record<string, string | undefined>) => unknown;
  readSecrets?: (env: Record<string, string | undefined>) => unknown;
}

export interface SettingsLoadInput {
  env?: Record<string, string | undefined>;
  secretsEnv?: Record<string, string | undefined>;
}

export interface SettingsLoadResult<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined
> {
  settings: ZodInfer<TSettingsSchema>;
  secrets: TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;
}

export function createSettingsLoader<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined
>(
  options: SettingsLoaderOptions<TSettingsSchema, TSecretsSchema>
) {
  const readSettings = options.readSettings ?? ((env: Record<string, string | undefined>) => env);
  const readSecrets = options.readSecrets ?? ((env: Record<string, string | undefined>) => env);

  return function loadSettings(
    input: SettingsLoadInput = {}
  ): SettingsLoadResult<TSettingsSchema, TSecretsSchema> {
    const env = input.env ?? process.env;
    const secretsEnv = input.secretsEnv ?? process.env;

    const settings = options.settingsSchema.parse(readSettings(env));
    const secrets = options.secretsSchema
      ? options.secretsSchema.parse(readSecrets(secretsEnv))
      : undefined;

    return { settings, secrets } as SettingsLoadResult<TSettingsSchema, TSecretsSchema>;
  };
}
