/* global document -- used inside page.evaluate, which runs in the app's window */
// Regenerates the README screenshots in docs/images from the built app in Demo mode (ADR-0011).
// Demo data only: no real session, path, name or photo can appear. Run `npm run build` first, then `npm run screenshots`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

const OUT = 'docs/images'
const SIZE = { width: 1440, height: 924 }
const SCALE = 1

/** Strip CLAUDE* so a run inside Claude Code can't leak in; never poll real sessions; the config dir is the temp profile. */
function env(userData) {
  const clean = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CLAUDE')) clean[k] = v
  return { ...clean, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', AGENTDECK_THEME: 'light', CLAUDE_CONFIG_DIR: userData }
}

const userData = mkdtempSync(join(tmpdir(), 'agentdeck-shots-'))
writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true, autostartConfigured: true, trayHintShown: true }))
mkdirSync(OUT, { recursive: true })

const app = await electron.launch({ args: ['.', `--force-device-scale-factor=${SCALE}`], env: env(userData) })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setSize(size.width, size.height)
    w.center()
  }, SIZE)
  await page.waitForSelector('[data-testid="home"]')

  const nav = page.getByRole('navigation', { name: 'Main' })
  const shot = async (name, open) => {
    await open()
    await page.mouse.move(SIZE.width - 4, SIZE.height - 4) // park the pointer: no hover state in the picture
    await page.evaluate(() => document.querySelector('main').scrollTo({ top: 0, behavior: 'instant' })) // every picture starts at the page's top
    await page.waitForTimeout(700) // enter animations finish
    await page.screenshot({ path: join(OUT, `${name}.png`) })
    console.log(`wrote ${OUT}/${name}.png`)
  }

  await shot('home', () => nav.getByRole('button', { name: /^Home/ }).click())
  await shot('tasks', () => nav.getByRole('button', { name: /^Tasks/ }).click())
  await shot('approvals', () => nav.getByRole('button', { name: /^Approvals/ }).click())
  await shot('report', () => nav.getByRole('button', { name: /^Daily report/ }).click())
  await shot('settings', () => page.getByRole('button', { name: /Settings/ }).first().click())
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
