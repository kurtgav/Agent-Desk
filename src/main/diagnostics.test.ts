import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { agentViewFrom, buildChecks, folderWritable, portBound, type CheckInput } from './diagnostics'

const ok = (stdout: string, code: number | null = 0) => ({ code, stdout, stderr: '' })

const HEALTHY: CheckInput = {
  demo: false,
  collectorRunning: true,
  port: 47821,
  portBound: true,
  hooks: 'installed',
  hooksError: null,
  conflicts: [],
  claudePath: 'C:\\Users\\a\\.local\\bin\\claude.exe',
  claudeVersion: '2.1.318',
  agentView: { state: 'ok', sessions: 3 },
  reportFolder: { path: 'C:\\Reports', writable: true, reason: null }
}
const byId = (c: CheckInput) => Object.fromEntries(buildChecks(c).map((x) => [x.id, x]))

describe('buildChecks', () => {
  it('lists the six live checks in order, all ok when nothing is wrong', () => {
    const checks = buildChecks(HEALTHY)
    expect(checks.map((c) => c.id)).toEqual(['collector', 'port', 'hooks', 'claude', 'agent-view', 'report-folder'])
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(checks.every((c) => c.detail.length > 0)).toBe(true)
  })

  it('a stopped collector fails both the collector and the port check, in words', () => {
    const c = byId({ ...HEALTHY, collectorRunning: false, port: null, portBound: false })
    expect(c.collector).toMatchObject({ ok: false })
    expect(c.port).toMatchObject({ ok: false, detail: 'The collector has not started listening yet.' })
  })

  it('a port nobody answers on names the port', () => {
    expect(byId({ ...HEALTHY, portBound: false }).port?.detail).toBe('Nothing answers on 127.0.0.1:47821.')
  })

  it('hooks: missing, unreadable file and a settings conflict each fail with their own reason', () => {
    expect(byId({ ...HEALTHY, hooks: 'missing' }).hooks?.detail).toMatch(/^Not installed/)
    expect(byId({ ...HEALTHY, hooks: 'error', hooksError: 'Could not read x' }).hooks?.detail).toBe('Could not read x')
    const conflict = byId({ ...HEALTHY, conflicts: ['disableAllHooks is true.'] }).hooks
    expect(conflict).toMatchObject({ ok: false, detail: 'disableAllHooks is true.' })
  })

  it('Claude Code: not found, found without a version, found', () => {
    expect(byId({ ...HEALTHY, claudePath: null, claudeVersion: null }).claude).toMatchObject({ ok: false })
    expect(byId({ ...HEALTHY, claudeVersion: null }).claude?.detail).toContain('did not report a version')
    expect(byId(HEALTHY).claude).toMatchObject({ ok: true, detail: 'Version 2.1.318.' })
  })

  it('a folder that can not be written says where and why', () => {
    const c = byId({ ...HEALTHY, reportFolder: { path: 'D:\\Out', writable: false, reason: 'It is a file, not a folder.' } })
    expect(c['report-folder']).toMatchObject({ ok: false, detail: 'D:\\Out: It is a file, not a folder.' })
  })

  it('demo data lists the data source, Claude Code and the folder, and does not call a stopped collector a fault', () => {
    const checks = buildChecks({ ...HEALTHY, demo: true, collectorRunning: false, port: null, portBound: false, hooks: 'missing' })
    expect(checks.map((c) => c.id)).toEqual(['mode', 'claude', 'report-folder'])
    expect(checks[0]).toMatchObject({ ok: true })
  })
})

describe('agentViewFrom', () => {
  it('a JSON array is agent view working', () => {
    expect(agentViewFrom({}, ok('[{"id":"a"},{"id":"b"}]'))).toEqual({ state: 'ok', sessions: 2 })
    expect(agentViewFrom({}, ok('[]'))).toEqual({ state: 'ok', sessions: 0 })
  })

  it('the environment switch, a missing CLI, a timeout and bad output each get their own state', () => {
    expect(agentViewFrom({ CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' }, ok('[]'))).toEqual({ state: 'disabled' })
    expect(agentViewFrom({}, null)).toEqual({ state: 'skipped' })
    expect(agentViewFrom({}, ok('', null))).toEqual({ state: 'no-answer' })
    expect(agentViewFrom({}, ok('Agent view is disabled.'))).toEqual({ state: 'unavailable' })
    expect(agentViewFrom({}, ok('{"not":"an array"}'))).toEqual({ state: 'unavailable' })
    expect(agentViewFrom({}, ok('[]', 1))).toEqual({ state: 'unavailable' })
  })
})

describe('folderWritable', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdeck-diag-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('an existing folder is writable and the probe file is gone again', async () => {
    expect(await folderWritable(root)).toEqual({ writable: true, reason: null })
  })

  it('a folder that does not exist yet is judged by the nearest one that does', async () => {
    expect(await folderWritable(join(root, 'not', 'yet'))).toEqual({ writable: true, reason: null })
  })

  it('a file where a folder should be is refused', async () => {
    const file = join(root, 'a-file')
    writeFileSync(file, '')
    expect(await folderWritable(file)).toMatchObject({ writable: false, reason: 'It is a file, not a folder.' })
  })
})

describe('portBound', () => {
  it('true while something listens, false once it stops', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    expect(await portBound(port)).toBe(true)
    await new Promise((resolve) => server.close(resolve))
    expect(await portBound(port)).toBe(false)
  })
})
