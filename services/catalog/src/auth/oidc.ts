import { Issuer, generators, type Client, type TokenSet } from 'openid-client';
import { getAuthConfig } from '../config/auth';

let cachedClient: Client | null = null;
let clientPromise: Promise<Client> | null = null;

export type AuthorizationRequest = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  authorizationUrl: string;
};

async function buildClient(): Promise<Client> {
  const config = getAuthConfig();
  if (!config.oidc.enabled) {
    throw new Error('OIDC is not enabled');
  }
  if (!config.oidc.issuer || !config.oidc.clientId || !config.oidc.clientSecret || !config.oidc.redirectUri) {
    throw new Error('OIDC configuration is incomplete');
  }

  const issuer = await Issuer.discover(config.oidc.issuer);
  return new issuer.Client({
    client_id: config.oidc.clientId,
    client_secret: config.oidc.clientSecret,
    redirect_uris: [config.oidc.redirectUri],
    response_types: ['code']
  });
}

export async function getOidcClient(): Promise<Client> {
  if (cachedClient) {
    return cachedClient;
  }
  if (!clientPromise) {
    clientPromise = buildClient().then((client) => {
      cachedClient = client;
      return client;
    });
  }
  return clientPromise;
}

export async function createAuthorizationRequest(scope = 'openid email profile'): Promise<AuthorizationRequest> {
  const client = await getOidcClient();
  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const config = getAuthConfig();
  const authorizationUrl = client.authorizationUrl({
    scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: config.oidc.redirectUri ?? undefined
  });
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
}): Promise<TokenSet> {
  const client = await getOidcClient();
  const config = getAuthConfig();
  const tokenSet = await client.callback(
    config.oidc.redirectUri ?? undefined,
    { state: params.state, code: params.code },
    {
      state: params.state,
      nonce: params.nonce,
      code_verifier: params.codeVerifier
    }
  );
  return tokenSet;
}

