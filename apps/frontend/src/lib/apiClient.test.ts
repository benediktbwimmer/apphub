import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApiClient } from './apiClient';

describe('createApiClient', () => {
  it('performs GET requests with base url, query params, and schema validation', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('https://example.test/jobs?limit=10');
      expect(init?.method).toBe('GET');
      return new Response(
        JSON.stringify({ data: [{ id: 'job-1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = createApiClient(fetcher, { baseUrl: 'https://example.test' });
    const schema = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .transform(({ data }) => data);

    const result = await client.get('/jobs', {
      query: { limit: 10 },
      schema,
      errorMessage: 'Failed to fetch jobs'
    });

    expect(result).toEqual([{ id: 'job-1' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('merges default headers, applies json body, and validates responses', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('https://example.test/action');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-app')).toBe('frontend');
      expect(headers.get('x-request')).toBe('call-123');
      expect(headers.get('content-type')).toBe('application/json');
      expect(init?.body).toBe(JSON.stringify({ foo: 'bar' }));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = createApiClient(fetcher, {
      defaultHeaders: { 'x-app': 'frontend' }
    });

    const response = await client.post('https://example.test/action', {
      headers: { 'x-request': 'call-123' },
      json: { foo: 'bar' },
      schema: z.object({ ok: z.boolean() })
    });

    expect(response).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps http errors to ApiError with parsed message', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'nope' }), { status: 404 });
    });

    const client = createApiClient(fetcher, { baseUrl: 'https://example.test' });

    await expect(client.get('/missing', { errorMessage: 'Not found' })).rejects.toMatchObject({
      message: 'nope',
      status: 404,
      details: { error: 'nope' }
    });
  });

  it('propagates parsing failures as ApiError', async () => {
    const fetcher = vi.fn(async () => new Response('not-json', { status: 200 }));
    const client = createApiClient(fetcher);

    await expect(client.get('/broken')).rejects.toMatchObject({
      message: 'Failed to parse server response',
      status: 200,
      details: 'not-json'
    });
  });

  it('supports transform to derive final shape', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ data: [1, 2, 3] }), { status: 200 });
    });

    const client = createApiClient(fetcher);

    const result = await client.get('/numbers', {
      schema: z.object({ data: z.array(z.number()) }),
      transform: ({ data }) => data.reduce((acc, value) => acc + value, 0)
    });

    expect(result).toBe(6);
  });
});
