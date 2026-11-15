/* global document, Image -- used inside page.evaluate, which runs in the page being drawn */
// Regenerates resources/agent-bot.png (256x256) from docs/images/agent-bot.webp. Electron's nativeImage cannot decode
// WebP, so the toast icon is a PNG. Run `node scripts/make-bot-icon.mjs`; it needs no build, Playwright's Chromium
// decodes the WebP and scales it.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const SRC = resolve('docs/images/agent-bot.webp')
const OUT = resolve('resources/agent-bot.png')
const SIZE = 256

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const webp = `data:image/webp;base64,${readFileSync(SRC).toString('base64')}`
  const png = await page.evaluate(
    async ({ src, size }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, size, size)
      return canvas.toDataURL('image/png')
    },
    { src: webp, size: SIZE }
  )
  writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'))
} finally {
  await browser.close()
}
