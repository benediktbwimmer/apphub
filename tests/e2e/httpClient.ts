import { setTimeout as sleep } from 'node:timers/promises';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
  expectedStatus?: number;
  timeoutMs?: number;
};

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 30_000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    const expected = options.expectedStatus ?? 200;
    if (response.status !== expected) {
      const text = await response.text().catch(() => '');
      throw new Error(`Request to ${url} failed (${response.status} ${response.statusText}): ${text}`);
    }

    if (expected === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function waitForEndpoint(
  url: string,
  options: { token?: string; timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined
      });
      if (response.ok) {
        return;
      }
    } catch {
      // ignored; retry below
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${url} to respond with 200`);
}
