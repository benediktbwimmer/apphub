import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import mdx from '@astrojs/mdx'

export default defineConfig({
  srcDir: './src',
  integrations: [react(), mdx()]
})
