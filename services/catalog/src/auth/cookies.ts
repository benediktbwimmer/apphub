import { fromBase64Url, signHmacSha256, toBase64Url, verifyHmacSha256 } from './crypto';

type SignedPayload = Record<string, unknown>;

function encodePayload(payload: SignedPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(Buffer.from(json, 'utf8'));
}

function decodePayload<T extends SignedPayload>(input: string): T | null {
  try {
    const buffer = fromBase64Url(input);
    const json = buffer.toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function signCookiePayload(payload: SignedPayload, secret: string): string {
  const encoded = encodePayload(payload);
  const signature = signHmacSha256(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifyCookiePayload<T extends SignedPayload>(value: string, secret: string): T | null {
  if (!value || !secret) {
    return null;
  }
  const parts = value.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadPart, signaturePart] = parts;
  if (!verifyHmacSha256(payloadPart, signaturePart, secret)) {
    return null;
  }
  return decodePayload<T>(payloadPart);
}

export type SessionCookiePayload = {
  id: string;
  token: string;
  issuedAt: number;
};

export function encodeSessionCookie(payload: SessionCookiePayload, secret: string): string {
  return signCookiePayload(payload, secret);
}

export function decodeSessionCookie(value: string, secret: string): SessionCookiePayload | null {
  return verifyCookiePayload<SessionCookiePayload>(value, secret);
}

export type LoginStateCookiePayload = {
  state: string;
  codeVerifier: string;
  nonce: string;
  issuedAt: number;
  redirectTo?: string;
};

export function encodeLoginStateCookie(payload: LoginStateCookiePayload, secret: string): string {
  return signCookiePayload(payload, secret);
}

export function decodeLoginStateCookie(value: string, secret: string): LoginStateCookiePayload | null {
  return verifyCookiePayload<LoginStateCookiePayload>(value, secret);
}

