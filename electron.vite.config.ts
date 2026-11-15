import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

/**
 * Dev server only: plugin-react's refresh preamble is an inline script, which index.html's CSP (`script-src 'self'`,
 * ADR-0010) blocks, so every component throws "can't detect preamble" and the window stays blank. Allow exactly
 * those inline scripts by hash; the built app has none and keeps the policy unchanged.
 */
function devInlineScriptHashes(): Plugin {
  return {
    name: 'agentdeck:dev-inline-script-hashes',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(
          ([, body]) => `'sha256-${createHash('sha256').update(body ?? '').digest('base64')}'`
        )
        return hashes.length ? html.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`) : html
      }
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // The collector runs in its own utility process (ADR-0002) and ships next to main as out/main/collector.js.
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), collector: resolve('src/collector/index.ts') } } }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), devInlineScriptHashes()]
  }
})
