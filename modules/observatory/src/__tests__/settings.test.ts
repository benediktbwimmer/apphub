import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultSecrets } from '../config/settings';

describe('observatory defaults', () => {
  it('exposes sane filestore defaults', () => {
    const settings = defaultSettings();
    expect(settings.filestore.baseUrl).toBeDefined();
    expect(typeof settings.filestore.baseUrl).toBe('string');
    expect(settings.filestore.baseUrl.length).toBeGreaterThan(0);
  });

  it('does not require secrets by default', () => {
    const secrets = defaultSecrets();
    expect(secrets.filestoreToken).toBeUndefined();
  });
});
