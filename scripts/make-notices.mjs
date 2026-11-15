// Writes THIRD_PARTY_NOTICES.md: the licence of every package the app imports at run time, plus its dependencies.
// Dev tools that are not shipped are left out. Needs `npm ci` first (it reads licence files from node_modules).
// Run: node scripts/make-notices.mjs   (rerun before a release, whenever dependencies change)
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2] ?? 'THIRD_PARTY_NOTICES.md'
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, found)
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) found.push(full)
  }
  return found
}

// Packages imported by the app's own source (tests excluded); Tailwind's compiled CSS is shipped too.
const roots = new Set(['tailwindcss'])
for (const file of sourceFiles('src')) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [, spec] of text.matchAll(/(?:from\s+|import\s+|@import\s+)['"]([^'"]+)['"]/g)) {
    if (/^(\.|node:|@shared|@\/|electron$)/.test(spec)) continue
    roots.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
  }
}

const included = new Map()
function visit(name, parentKey) {
  const key = [parentKey && `${parentKey}/node_modules/${name}`, `node_modules/${name}`].find((k) => k && lock[k])
  if (!key || included.has(key)) return
  included.set(key, lock[key])
  for (const dep of Object.keys(lock[key].dependencies ?? {})) visit(dep, key)
}
for (const root of roots) visit(root, null)

const rows = [...included]
  .map(([dir, pkg]) => ({ name: dir.replace(/^.*node_modules\//, ''), version: pkg.version, license: pkg.license ?? 'UNKNOWN', dir }))
  .sort((a, b) => a.name.localeCompare(b.name))

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((n) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(n))
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : null
}

// The agent avatars: every image in the folder is one more logo from the same gallery, so the credit lists them.
const MASCOT_DIR = 'src/renderer/src/assets/agents'
const mascots = fs.readdirSync(MASCOT_DIR).filter((n) => n.endsWith('.webp')).map((n) => n.slice(0, -5)).sort()

// The role mascots are named after their role; credits.tsv beside them says which gallery logo each one is.
const ROLE_ART_DIR = 'src/renderer/src/assets/roles'
const roleArt = fs.readFileSync(path.join(ROLE_ART_DIR, 'credits.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'))
const missing = fs.readdirSync(ROLE_ART_DIR).filter((n) => n.endsWith('.webp') && !roleArt.some(([role]) => `${role}.webp` === n))
if (missing.length) throw new Error(`No credit in ${ROLE_ART_DIR}/credits.tsv for: ${missing.join(', ')}`)
// A session row shows its agent avatar beside its role face, so the two sets never share a picture.
const shared = roleArt.filter(([, logo]) => mascots.includes(logo)).map(([role, logo]) => `${role} (${logo})`)
if (shared.length) throw new Error(`Role mascots that are also agent avatars: ${shared.join(', ')}`)

let md = `# Third-party notices

AgentDeck is MIT licensed (see LICENSE). The installer bundles the open-source packages below, and Electron with Chromium (their licences ship in the install folder as LICENSE.electron.txt and LICENSES.chromium.html). This list is generated from package-lock.json for the packages the app imports at run time and their dependencies. Development tools that are not shipped are not listed.

The Inter typeface (bundled through @fontsource-variable/inter) is licensed under the SIL Open Font License 1.1. Its text is under that package below.

The bot mascot (src/renderer/src/assets/agent-bot.webp, docs/images/agent-bot.webp) is the "helper-robot" logo from IP as Logo (https://visualskills.dev/ip-as-logo). The project's README (https://github.com/s1dashu/ip-as-logo-skill, MIT) says: "Every logo is free for commercial use." It is credited here and in the README; if its author asks for a change, replace the image.

The agent avatars (${MASCOT_DIR}/*.webp, ${mascots.length} images) are more logos from the same IP as Logo gallery, each downscaled to 128x128 pixels; the same README sentence covers them: "Every logo is free for commercial use." Each agent name is mapped to one of them by a hash (src/renderer/src/lib/avatar.ts). They are credited here and in the README; if the author asks for a change, remove or replace the images. The logos used, by gallery name: ${mascots.join(', ')}.

The role mascots (${ROLE_ART_DIR}/*.webp, ${roleArt.length} images) are more logos from the same IP as Logo gallery, each downscaled to 128x128 pixels and named after the role it was chosen for; the same README sentence covers them: "Every logo is free for commercial use." A role you write yourself keeps its emoji. They are credited here and in the README; if the author asks for a change, remove or replace the images. The logos used, as role: gallery name: ${roleArt.map(([role, logo]) => `${role}: ${logo}`).join(', ')}.

The Roles page lists roles from msitarzewski/agency-agents (https://github.com/msitarzewski/agency-agents, MIT licence, Copyright (c) 2025 AgentLand Contributors). AgentDeck does not bundle or download that library: it reads the user's own clone on their PC, wherever they cloned it, and shows each role's name, one-liner and description. A role's text is used only when the user starts a conversation or task as that role. The seven leadership roles that do ship with the app (resources/roles: CTO, Founding Engineer, Principal Engineer, VP of Engineering, Head of Product, Head of Marketing, Head of Design) were written for AgentDeck and are MIT licensed with the rest of it; they contain no text from agency-agents.

## Packages

| Package | Version | Licence |
|---|---|---|
`
for (const r of rows) md += `| ${r.name} | ${r.version} | ${r.license} |\n`
md += '\n## Licence texts\n'
for (const r of rows) {
  const text = licenseText(r.dir)
  const body = text ? '```text\n' + text + '\n```' : 'The package ships no licence file; it declares this licence in its package.json.'
  md += `\n### ${r.name} ${r.version} (${r.license})\n\n${body}\n`
}
fs.writeFileSync(OUT, md)
console.log(`Wrote ${OUT}: ${rows.length} packages, licences: ${[...new Set(rows.map((r) => r.license))].join(', ')}`)
