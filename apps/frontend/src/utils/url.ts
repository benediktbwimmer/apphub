import { API_BASE_URL } from '../config';

const LOOPBACK_HOST_PREFIX = /^127\./;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1', '0.0.0.0']);

export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  return LOOPBACK_HOSTS.has(normalized) || LOOPBACK_HOST_PREFIX.test(normalized);
}

function getPreviewBaseCandidates(): URL[] {
  const bases: URL[] = [];

  try {
    bases.push(new URL(API_BASE_URL));
  } catch {
    // ignore invalid API base URL
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      bases.push(new URL(window.location.origin));
    } catch {
      // ignore invalid browser origin
    }
  }

  return bases;
}

export function normalizePreviewUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return null;
  }

  const candidates = getPreviewBaseCandidates();
  let parsed: URL;

  try {
    if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
      parsed = new URL(trimmedUrl);
    } else if (candidates.length > 0) {
      parsed = new URL(trimmedUrl, candidates[0]);
    } else if (typeof window !== 'undefined' && window.location?.origin) {
      parsed = new URL(trimmedUrl, window.location.origin);
    } else {
      parsed = new URL(trimmedUrl);
    }
  } catch {
    return null;
  }

  if (!isLoopbackHost(parsed.hostname)) {
    return parsed.toString();
  }

  for (const base of candidates) {
    if (!isLoopbackHost(base.hostname)) {
      parsed.protocol = base.protocol;
      parsed.hostname = base.hostname;
      parsed.port = base.port;
      return parsed.toString();
    }
  }

  return parsed.toString();
}
