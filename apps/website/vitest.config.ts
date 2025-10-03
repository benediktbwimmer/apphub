import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@components': resolve(root, 'src/components'),
      '@layouts': resolve(root, 'src/layouts'),
      '@pages': resolve(root, 'src/pages'),
      '@data': resolve(root, 'src/data')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true
  }
})
