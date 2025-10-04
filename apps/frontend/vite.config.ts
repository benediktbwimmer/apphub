import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdirSync, Dirent } from 'node:fs';
import { createRequire } from 'node:module';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { generateThemeCss } from './src/theme/generateThemeCss';

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(frontendRoot, '..', '..');
const coreSrcPath = resolve(workspaceRoot, 'services', 'core', 'src');
const sharedSrcPath = resolve(workspaceRoot, 'packages', 'shared', 'src');
const moduleRegistrySrcPath = resolve(workspaceRoot, 'packages', 'module-registry', 'src');
const designTokenSrcDir = resolve(workspaceRoot, 'packages', 'shared', 'src', 'designTokens');
const designTokenDistDir = resolve(workspaceRoot, 'packages', 'shared', 'dist', 'designTokens');

const require = createRequire(import.meta.url);

const THEME_CSS_MODULE_ID = 'virtual:apphub-theme.css';
const RESOLVED_THEME_CSS_MODULE_ID = `\0${THEME_CSS_MODULE_ID}`;

type DesignTokensModule = {
  foundation: import('@apphub/shared/designTokens').DesignTokenFoundation;
  defaultThemeRegistry: import('@apphub/shared/designTokens').ThemeRegistry;
};

function collectFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function loadDesignTokens(): DesignTokensModule {
  const modulePath = require.resolve('@apphub/shared/designTokens');
  delete require.cache[modulePath];
  return require('@apphub/shared/designTokens') as DesignTokensModule;
}

function createThemeCssPlugin(): PluginOption {
  const generateCss = () => {
    const { foundation, defaultThemeRegistry } = loadDesignTokens();
    return generateThemeCss({
      foundation,
      themes: defaultThemeRegistry,
      options: { defaultThemeId: 'apphub-light' }
    });
  };

  let css = generateCss();

  return {
    name: 'apphub-theme-css',
    enforce: 'pre',
    resolveId(id) {
      if (id === THEME_CSS_MODULE_ID) {
        return RESOLVED_THEME_CSS_MODULE_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_THEME_CSS_MODULE_ID) {
        return css;
      }
      return null;
    },
    buildStart() {
      const watchDirs = [designTokenSrcDir, designTokenDistDir];
      for (const dir of watchDirs) {
        for (const file of collectFiles(dir)) {
          this.addWatchFile(file);
        }
      }
    },
    handleHotUpdate(ctx) {
      const shouldReload = ctx.file.startsWith(designTokenSrcDir) || ctx.file.startsWith(designTokenDistDir);
      if (!shouldReload) {
        return undefined;
      }

      css = generateCss();
      const module = ctx.server.moduleGraph.getModuleById(RESOLVED_THEME_CSS_MODULE_ID);
      if (module) {
        ctx.server.moduleGraph.invalidateModule(module);
        return [module];
      }
      return undefined;
    }
  } satisfies PluginOption;
}

// https://vite.dev/config/
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [createThemeCssPlugin(), react(), tailwindcss()],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: [
      { find: '@apphub/core', replacement: coreSrcPath },
      { find: '@apphub/shared', replacement: sharedSrcPath },
      { find: /^@apphub\/module-registry$/, replacement: resolve(moduleRegistrySrcPath, 'index.browser.ts') },
      { find: '@apphub/module-registry/', replacement: `${moduleRegistrySrcPath}/` }
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
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/**']
  }
};

export default defineConfig(config);
