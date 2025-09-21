import { defineConfig, type UserConfig } from 'vite';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    globals: true
  }
};

export default defineConfig(config);
