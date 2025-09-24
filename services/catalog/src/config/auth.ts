const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseIntWithDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function parseStringSet(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

export type OidcConfig = {
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  allowedDomains: Set<string>;
};

export type AuthConfig = {
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

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const sessionSecret = process.env.APPHUB_SESSION_SECRET ?? '';
  const sessionCookieName = process.env.APPHUB_SESSION_COOKIE ?? 'apphub_session';
  const loginStateCookieName = process.env.APPHUB_LOGIN_STATE_COOKIE ?? 'apphub_login_state';
  const sessionTtlSeconds = parseIntWithDefault(process.env.APPHUB_SESSION_TTL_SECONDS, 12 * 60 * 60);
  const sessionRenewSeconds = parseIntWithDefault(process.env.APPHUB_SESSION_RENEW_SECONDS, 30 * 60);
  const sessionCookieSecure = parseBoolean(
    process.env.APPHUB_SESSION_COOKIE_SECURE,
    process.env.NODE_ENV !== 'development'
  );
  const legacyTokensEnabled = parseBoolean(process.env.APPHUB_LEGACY_OPERATOR_TOKENS, true);
  const apiKeyScope = process.env.APPHUB_AUTH_API_KEY_SCOPE ?? 'auth:manage-api-keys';

  const oidcEnabled = parseBoolean(process.env.APPHUB_AUTH_SSO_ENABLED, false);
  const oidcIssuer = process.env.APPHUB_OIDC_ISSUER ?? null;
  const oidcClientId = process.env.APPHUB_OIDC_CLIENT_ID ?? null;
  const oidcClientSecret = process.env.APPHUB_OIDC_CLIENT_SECRET ?? null;
  const oidcRedirectUri = process.env.APPHUB_OIDC_REDIRECT_URI ?? null;
  const oidcAllowedDomains = parseStringSet(process.env.APPHUB_OIDC_ALLOWED_DOMAINS);

  cachedConfig = {
    sessionSecret,
    sessionCookieName,
    loginStateCookieName,
    sessionTtlSeconds,
    sessionRenewSeconds,
    sessionCookieSecure,
    legacyTokensEnabled,
    apiKeyScope,
    oidc: {
      enabled: oidcEnabled,
      issuer: oidcIssuer,
      clientId: oidcClientId,
      clientSecret: oidcClientSecret,
      redirectUri: oidcRedirectUri,
      allowedDomains: oidcAllowedDomains
    }
  } satisfies AuthConfig;

  return cachedConfig;
}
