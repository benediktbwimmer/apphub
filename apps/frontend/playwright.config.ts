import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uiPort = Number(process.env.FRONTEND_UI_PORT ?? '4173');
const appOrigin = `http://127.0.0.1:${uiPort}`;

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: appOrigin,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${uiPort}`,
    cwd: __dirname,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    port: uiPort,
    env: {
      ...process.env,
      VITE_API_BASE_URL: appOrigin
    }
  }
});
