import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
  type TokenEndpointResponse,
  type TokenEndpointResponseHelpers
} from 'openid-client';
import { getAuthConfig } from '../config/auth';

type TokenResponse = TokenEndpointResponse & TokenEndpointResponseHelpers;

let cachedConfiguration: Configuration | null = null;
let configurationPromise: Promise<Configuration> | null = null;

export type AuthorizationRequest = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  authorizationUrl: string;
};

async function buildConfiguration(): Promise<Configuration> {
  const config = getAuthConfig();
  if (!config.oidc.enabled) {
    throw new Error('OIDC is not enabled');
  }
  if (!config.oidc.issuer || !config.oidc.clientId || !config.oidc.clientSecret || !config.oidc.redirectUri) {
    throw new Error('OIDC configuration is incomplete');
  }

  const issuerUrl = new URL(config.oidc.issuer);

  return discovery(issuerUrl, config.oidc.clientId, {
    client_id: config.oidc.clientId,
    client_secret: config.oidc.clientSecret,
    redirect_uris: [config.oidc.redirectUri],
    response_types: ['code']
  });
}

export async function getOidcClient(): Promise<Configuration> {
  if (cachedConfiguration) {
    return cachedConfiguration;
  }
  if (!configurationPromise) {
    configurationPromise = buildConfiguration().then((result) => {
      cachedConfiguration = result;
      return result;
    });
  }
  return configurationPromise;
}

export async function createAuthorizationRequest(scope = 'openid email profile'): Promise<AuthorizationRequest> {
  const configuration = await getOidcClient();
  const state = randomState();
  const nonce = randomNonce();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const config = getAuthConfig();
  const authorizationUrl = buildAuthorizationUrl(configuration, {
    scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...(config.oidc.redirectUri ? { redirect_uri: config.oidc.redirectUri } : {})
  }).href;
  return {
    state,
    nonce,
    codeVerifier,
    codeChallenge,
    authorizationUrl
  } satisfies AuthorizationRequest;
}

export async function exchangeAuthorizationCode(params: {
  state: string;
  code: string;
  codeVerifier: string;
  nonce: string;
}): Promise<TokenResponse> {
  const configuration = await getOidcClient();
  const config = getAuthConfig();
  const redirectUri = config.oidc.redirectUri;
  if (!redirectUri) {
    throw new Error('OIDC redirect URI is not configured');
  }

  const currentUrl = new URL(redirectUri);
  currentUrl.searchParams.set('code', params.code);
  currentUrl.searchParams.set('state', params.state);

  return authorizationCodeGrant(configuration, currentUrl, {
    expectedState: params.state,
    expectedNonce: params.nonce,
    pkceCodeVerifier: params.codeVerifier
  });
}
