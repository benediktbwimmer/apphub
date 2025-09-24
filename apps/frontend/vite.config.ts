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

// https://vite.dev/config/
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@apphub/catalog': catalogSrcPath,
      '@apphub/shared': sharedSrcPath,
      '@apphub/examples-registry': examplesRegistrySrcPath
    }
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
