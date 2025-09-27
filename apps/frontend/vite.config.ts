import { defineConfig, type UserConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(frontendRoot, '..', '..');
const catalogSrcPath = resolve(workspaceRoot, 'services', 'catalog', 'src');
const sharedSrcPath = resolve(workspaceRoot, 'packages', 'shared', 'src');
const examplesRegistrySrcPath = resolve(workspaceRoot, 'packages', 'examples-registry', 'src');
const examplesRegistryEntryPath = resolve(examplesRegistrySrcPath, 'index.browser.ts');
const examplesRegistryTypesPath = resolve(examplesRegistrySrcPath, 'types.ts');

// https://vite.dev/config/
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [react(), tailwindcss()],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: [
      { find: '@apphub/catalog', replacement: catalogSrcPath },
      { find: '@apphub/shared', replacement: sharedSrcPath },
      { find: '@apphub/examples-registry/types', replacement: examplesRegistryTypesPath },
      { find: '@apphub/examples-registry', replacement: examplesRegistryEntryPath },
      { find: '@apphub/examples-registry/', replacement: `${examplesRegistrySrcPath}/` }
    ]
  },
  server: {
    fs: {
      allow: [workspaceRoot]
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    globals: true
  }
};

export default defineConfig(config);
