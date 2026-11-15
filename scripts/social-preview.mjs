/* global document -- used inside page.evaluate, which runs in the page being drawn */
// Renders docs/images/social-preview.png (1280x640, the size GitHub and X link previews use) from the bot mascot.
// Run `npm run social-preview`. Needs no build: it is plain HTML drawn by Playwright's Chromium.
import { existsSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const FONT = resolve('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
const BOT = resolve('docs/images/agent-bot.webp')
const OUT = resolve('docs/images/social-preview.png')
if (!existsSync(FONT) || !existsSync(BOT)) throw new Error('Run `npm ci` first, and keep docs/images/agent-bot.webp.')

const dir = mkdtempSync(join(tmpdir(), 'agentdeck-social-'))
copyFileSync(BOT, join(dir, 'bot.webp'))
copyFileSync(FONT, join(dir, 'inter.woff2'))
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url(inter.woff2) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0 }
body { width: 1280px; height: 640px; background: #f6f6f6; color: #111113; font-family: Inter, sans-serif; display: flex; align-items: center; padding: 0 88px 0 96px; gap: 72px; -webkit-font-smoothing: antialiased }
.copy { flex: 1; min-width: 0; display: flex; flex-direction: column }
.eyebrow { font-size: 22px; font-weight: 500; color: #64646b; letter-spacing: .01em }
h1 { font-size: 112px; line-height: 1; font-weight: 650; letter-spacing: -.035em; margin: 18px 0 26px }
p { font-size: 36px; line-height: 1.28; font-weight: 450; color: #2a2a2e; letter-spacing: -.012em; max-width: 21ch; text-wrap: balance }
.pills { display: flex; gap: 10px; margin-top: 44px }
.pills span { flex: none; white-space: nowrap; font-size: 19px; font-weight: 500; color: #3a3a40; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 999px; padding: 8px 16px }
img { flex: none; width: 420px; height: 420px; border-radius: 52px; box-shadow: 0 24px 60px rgb(40 20 10 / .16), 0 2px 6px rgb(40 20 10 / .08) }
</style>
<div class="copy">
  <div class="eyebrow">Windows tray app · Free · MIT</div>
  <h1>AgentDeck</h1>
  <p>See every Claude Code session on your PC, and the one that needs you.</p>
  <div class="pills"><span>Local only</span><span>Never auto-approves</span><span>No model calls of its own</span></div>
</div>
<img src="bot.webp" alt="">`
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(dir, 'index.html')).href)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: OUT })
  console.log(`wrote ${OUT}`)
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}
