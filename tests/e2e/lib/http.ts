import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number | number[];
  timeoutMs?: number;
}

export interface JsonResponse<T> {
  status: number;
  payload: T;
}

function ensureArray(value: number | number[] | undefined): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

export async function requestJson<T>(url: string | URL, options: RequestOptions = {}): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(url, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const expected = ensureArray(options.expectedStatus);
  if (expected && !expected.includes(response.status)) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status} ${response.statusText}): ${text}`);
  }

  if (!expected && !response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status} ${response.statusText}): ${text}`);
  }

  if (response.status === 204) {
    return { status: response.status, payload: undefined as T };
  }

  const payload = (await response.json()) as T;
  return { status: response.status, payload };
}

export interface WaitForEndpointOptions {
  expectedStatus?: number | number[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  headers?: Record<string, string>;
}

export async function waitForEndpoint(url: string | URL, options: WaitForEndpointOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await requestJson(url, {
        method: 'GET',
        headers: options.headers,
        expectedStatus: options.expectedStatus ?? [200]
      });
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await sleep(pollIntervalMs);
    }
  }

  throw new Error(`Timed out waiting for ${url.toString()}`);
}
