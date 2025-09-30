import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import semanticTokensPlugin from './eslint/semanticTokensPlugin.js'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/theme/**/*.{ts,tsx}'],
    plugins: {
      'semantic-tokens': semanticTokensPlugin
    },
    rules: {
      'semantic-tokens/no-raw-color-classnames': 'error'
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
