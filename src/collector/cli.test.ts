import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanEnv, isDesktopPath, launch, run, system32 } from './cli'

describe('cleanEnv (D-025, F8)', () => {
  it('drops every CLAUDE* variable except the config dir, and keeps the rest', () => {
    const env = cleanEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      claude_code_entrypoint: 'cli',
      CLAUDE_CONFIG_DIR: 'D:\\cfg',
      PATH: 'C:\\bin',
      USERPROFILE: 'C:\\Users\\k'
    })
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: 'D:\\cfg', PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\k' })
  })
})

describe('isDesktopPath (F1)', () => {
  it.each([
    ['C:\\Program Files\\WindowsApps\\Claude_1.2_x64\\app\\claude.exe', true],
    ['C:\\Users\\k\\AppData\\Local\\Claude-Data\\claude_1\\claude.exe', true],
    ['C:\\Users\\k\\.local\\bin\\claude.exe', false],
    ['C:\\Users\\k\\AppData\\Roaming\\npm\\claude.cmd', false]
  ])('%s → %s', (p, desktop) => expect(isDesktopPath(p)).toBe(desktop))
})

describe('run (ADR-0008)', () => {
  it('passes arguments as an array, with no shell to interpret them', async () => {
    const r = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'a & echo b | c'], 10_000)
    expect(r).toEqual({ code: 0, stdout: 'a & echo b | c', stderr: '' })
  })

  it('keeps stderr apart from stdout, so a CLI error can be shown as the CLI wrote it', async () => {
    const r = await run(process.execPath, ['-e', 'process.stderr.write("Workspace not trusted."); process.exit(1)'], 10_000)
    expect(r).toEqual({ code: 1, stdout: '', stderr: 'Workspace not trusted.' })
  })

  it('kills a child that outlives its timeout', async () => {
    const started = Date.now()
    const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], 300)
    expect(r.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('settles on timeout even when a .cmd shim leaves a child holding the pipe (code review LOW-9)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentdeck-shim-'))
    try {
      const shim = join(dir, 'slow.cmd')
      writeFileSync(shim, `@echo off\r\n"${process.execPath}" -e "setTimeout(() => {}, 4000)"\r\n`)
      const started = Date.now()
      expect(await run(shim, [], 300)).toEqual({ code: null, stdout: '', stderr: '' })
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  }, 10_000)

  it('runs Windows tools by absolute path, never a bare name looked up in the cwd (security review LOW-6)', () => {
    expect(system32('where.exe')).toMatch(/^[A-Z]:\\.+\\System32\\where\.exe$/i)
  })

  it('reports a missing executable instead of throwing', async () => {
    expect(await run('Z:\\no\\such\\claude.exe', ['--version'], 1_000)).toEqual({ code: null, stdout: '', stderr: expect.stringContaining('ENOENT') })
  })
})

describe('launch (ADR-0008, D-095)', () => {
  it('resolves null for a program that exits cleanly', async () => {
    expect(await launch(process.execPath, ['-e', ''], { hide: true })).toBeNull()
  })

  it('resolves null for one still running when the watch ends, and leaves it running', async () => {
    expect(await launch(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { hide: true, watchMs: 200 })).toBeNull()
  })

  it('reports a program that fails right away, by its exit code', async () => {
    expect(await launch(process.execPath, ['-e', 'process.exit(3)'], { hide: true })).toMatch(/exited with 3\.$/)
  })

  it('reports why a program could not start', async () => {
    expect(await launch('Z:\\no\\such\\code.exe', [], { hide: true })).toMatch(/not found/)
  })
})
