import { defineConfig, type UserConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(frontendRoot, '..', '..');
const workflowSchemaPath = resolve(workspaceRoot, 'services', 'catalog', 'src', 'workflows', 'zodSchemas.ts');

// https://vite.dev/config/
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@apphub/workflow-schemas': workflowSchemaPath
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
