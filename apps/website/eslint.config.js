import js from '@eslint/js'
import globals from 'globals'
import astro from 'eslint-plugin-astro'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  {
    ignores: ['dist', '.astro']
  },
  ...astro.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended
    ],
    languageOptions: {
      globals: globals.browser
    }
  }
])
