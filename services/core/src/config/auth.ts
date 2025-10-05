import { z } from 'zod';
import {
  booleanVar,
  integerVar,
  loadEnvConfig,
  stringSetVar,
  stringVar
} from '@apphub/shared/envConfig';

export type OidcConfig = {
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  allowedDomains: Set<string>;
};

export type AuthConfig = {
  enabled: boolean;
  sessionSecret: string;
  sessionCookieName: string;
  loginStateCookieName: string;
  sessionTtlSeconds: number;
  sessionRenewSeconds: number;
  sessionCookieSecure: boolean;
  legacyTokensEnabled: boolean;
  apiKeyScope: string;
  oidc: OidcConfig;
};

let cachedConfig: AuthConfig | null = null;

const authEnvSchema = z
  .object({
    NODE_ENV: stringVar({ defaultValue: 'development', lowercase: true }),
    APPHUB_AUTH_DISABLED: booleanVar({ defaultValue: false }),
    APPHUB_SESSION_SECRET: stringVar({ defaultValue: '' }),
    APPHUB_SESSION_COOKIE: stringVar({ defaultValue: 'apphub_session' }),
    APPHUB_LOGIN_STATE_COOKIE: stringVar({ defaultValue: 'apphub_login_state' }),
    APPHUB_SESSION_TTL_SECONDS: integerVar({ defaultValue: 12 * 60 * 60, min: 1 }),
    APPHUB_SESSION_RENEW_SECONDS: integerVar({ defaultValue: 30 * 60, min: 1 }),
    APPHUB_SESSION_COOKIE_SECURE: booleanVar({ description: 'APPHUB_SESSION_COOKIE_SECURE' }),
    APPHUB_LEGACY_OPERATOR_TOKENS: booleanVar({ defaultValue: true }),
    APPHUB_AUTH_API_KEY_SCOPE: stringVar({ defaultValue: 'auth:manage-api-keys' }),
    APPHUB_AUTH_SSO_ENABLED: booleanVar({ defaultValue: false }),
    APPHUB_OIDC_ISSUER: stringVar({ allowEmpty: false }),
    APPHUB_OIDC_CLIENT_ID: stringVar({ allowEmpty: false }),
    APPHUB_OIDC_CLIENT_SECRET: stringVar({ allowEmpty: false }),
    APPHUB_OIDC_REDIRECT_URI: stringVar({ allowEmpty: false }),
    APPHUB_OIDC_ALLOWED_DOMAINS: stringSetVar({ lowercase: true, unique: true })
  })
  .passthrough()
  .transform((env) => {
    const nodeEnv = env.NODE_ENV ?? 'development';
    const sessionCookieSecure =
      env.APPHUB_SESSION_COOKIE_SECURE ?? nodeEnv !== 'development';

    return {
      enabled: !(env.APPHUB_AUTH_DISABLED ?? false),
      sessionSecret: env.APPHUB_SESSION_SECRET ?? '',
      sessionCookieName: env.APPHUB_SESSION_COOKIE ?? 'apphub_session',
      loginStateCookieName: env.APPHUB_LOGIN_STATE_COOKIE ?? 'apphub_login_state',
      sessionTtlSeconds: env.APPHUB_SESSION_TTL_SECONDS ?? 12 * 60 * 60,
      sessionRenewSeconds: env.APPHUB_SESSION_RENEW_SECONDS ?? 30 * 60,
      sessionCookieSecure,
      legacyTokensEnabled: env.APPHUB_LEGACY_OPERATOR_TOKENS ?? true,
      apiKeyScope: env.APPHUB_AUTH_API_KEY_SCOPE ?? 'auth:manage-api-keys',
      oidc: {
        enabled: env.APPHUB_AUTH_SSO_ENABLED ?? false,
        issuer: env.APPHUB_OIDC_ISSUER ?? null,
        clientId: env.APPHUB_OIDC_CLIENT_ID ?? null,
        clientSecret: env.APPHUB_OIDC_CLIENT_SECRET ?? null,
        redirectUri: env.APPHUB_OIDC_REDIRECT_URI ?? null,
        allowedDomains: env.APPHUB_OIDC_ALLOWED_DOMAINS ?? new Set<string>()
      }
    } satisfies AuthConfig;
  });

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = loadEnvConfig(authEnvSchema, { context: 'core:auth' });
  return cachedConfig;
}

export function resetAuthConfigCache(): void {
  cachedConfig = null;
}
