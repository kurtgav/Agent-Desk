import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // The collector runs in its own utility process (ADR-0002) and ships next to main as out/main/collector.js.
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), collector: resolve('src/collector/index.ts') } } }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
