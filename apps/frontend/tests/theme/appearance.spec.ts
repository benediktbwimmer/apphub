import { test, expect, type Route } from '@playwright/test';

const identityResponse = {
  data: {
    id: 'settings-user',
    email: 'settings@apphub.example',
    name: 'Theme Curator',
    scopes: ['settings:read', 'settings:write'],
    authDisabled: false
  }
};

const apiKeysResponse = {
  data: {
    keys: []
  }
};

const expectedAccent = '#2dd4bf';
const expectedSurface = '#02060f';

async function fulfillJson(route: Route, body: unknown, origin: string) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    },
    body: JSON.stringify(body)
  });
}

test.describe('Appearance settings themes', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use?.baseURL ?? 'http://127.0.0.1:4173';
    const origin = new URL(baseURL).origin;

    await page.addInitScript(() => {
      window.localStorage.setItem('apphub.theme-preference', 'system');
    });

    await page.route('**/auth/identity', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillJson(route, {}, origin);
        return;
      }
      await fulfillJson(route, identityResponse, origin);
    });

    await page.route('**/auth/api-keys', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillJson(route, {}, origin);
        return;
      }
      await fulfillJson(route, apiKeysResponse, origin);
    });
  });

  test('applies Nebula Drift palette variables when selected', async ({ page }) => {
    await page.goto('/settings/appearance');

    await page.getByRole('heading', { name: 'Appearance' }).waitFor();

    const nebulaOption = page.getByRole('radio', { name: 'Nebula Drift' });
    await nebulaOption.check({ force: true });

    await expect.poll(async () => {
      return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    }).toBe('apphub-nebula');

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent-default').trim()
    );
    expect(accent).toBe(expectedAccent);

    const surface = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-surface-canvas').trim()
    );
    expect(surface).toBe(expectedSurface);

    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('theme-dark')
    );
    expect(hasDarkClass).toBe(true);
  });
});
