import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config', () => {
  it('derives filestore base from the catalog proxy when unset', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4500/api/');

    const config = await import('./config');
    expect(config.FILESTORE_BASE_URL).toBe('http://localhost:4500/api/filestore');
  });

  it('honours explicit filestore base URL overrides', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000');
    vi.stubEnv('VITE_FILESTORE_BASE_URL', 'https://filestore.example.com/');

    const config = await import('./config');
    expect(config.FILESTORE_BASE_URL).toBe('https://filestore.example.com');
  });
});
