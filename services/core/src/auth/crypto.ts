import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function signHmacSha256(value: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(value).digest();
  return toBase64Url(hmac);
}

export function verifyHmacSha256(value: string, signature: string, secret: string): boolean {
  try {
    const expected = signHmacSha256(value, secret);
    const signatureBuffer = fromBase64Url(signature);
    const expectedBuffer = fromBase64Url(expected);
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export { toBase64Url, fromBase64Url };

