import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanEnv, isDesktopPath, launch, loginShellPath, resolveClaude, run, system32, which, type RunResult } from './cli'

const WIN = process.platform === 'win32'
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' })

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
    ['C:\\Users\\k\\AppData\\Roaming\\npm\\claude.cmd', false],
    ['/Applications/Claude.app/Contents/MacOS/Claude', true],
    ['/Users/k/Library/Application Support/Claude/claude-code/1.0/claude', true],
    ['/Users/k/.local/bin/claude', false],
    ['/opt/homebrew/bin/claude', false]
  ])('%s → %s', (p, desktop) => expect(isDesktopPath(p)).toBe(desktop))
})

describe('which', () => {
  it('asks where.exe on Windows and which -a elsewhere, one path a line', async () => {
    const calls: string[][] = []
    const exec = async (file: string, args: readonly string[]): Promise<RunResult> => {
      calls.push([file, ...args])
      return ok('/a/claude\n/b/claude\n')
    }
    expect(await which('claude', 'darwin', exec)).toEqual(['/a/claude', '/b/claude'])
    await which('claude', 'win32', exec)
    expect(calls[0]).toEqual(['/usr/bin/which', '-a', 'claude'])
    expect(calls[1]![0]).toMatch(/where\.exe$/)
  })

  it('finds nothing when the lookup fails', async () => {
    expect(await which('claude', 'darwin', async () => ({ code: 1, stdout: '', stderr: '' }))).toEqual([])
  })
})

describe('resolveClaude on macOS (D-024)', () => {
  const env = { HOME: '/Users/k' }
  const resolve = (on: { found?: string[]; present: string[] }) =>
    resolveClaude(undefined, env, 'darwin', { which: async () => on.found ?? [], exists: (p) => on.present.includes(p), isCli: async () => true })

  it('prefers the native installer in ~/.local/bin', async () => {
    const native = join('/Users/k', '.local', 'bin', 'claude') // path.join is the host's; on a Mac this is /Users/k/.local/bin/claude
    expect(await resolve({ found: ['/opt/homebrew/bin/claude'], present: [native, '/opt/homebrew/bin/claude'] })).toBe(native)
  })

  it('takes PATH next, skipping the copy inside Claude.app', async () => {
    const app = '/Applications/Claude.app/Contents/Resources/claude'
    expect(await resolve({ found: [app, '/Users/k/.nvm/versions/node/v24/bin/claude'], present: [app, '/Users/k/.nvm/versions/node/v24/bin/claude'] })).toBe('/Users/k/.nvm/versions/node/v24/bin/claude')
  })

  it('falls back to the Homebrew and /usr/local npm prefixes, in that order', async () => {
    expect(await resolve({ present: ['/usr/local/bin/claude'] })).toBe('/usr/local/bin/claude')
    expect(await resolve({ present: ['/usr/local/bin/claude', '/opt/homebrew/bin/claude'] })).toBe('/opt/homebrew/bin/claude')
  })

  it('finds nothing when no candidate is a Claude Code CLI', async () => {
    expect(await resolveClaude(undefined, env, 'darwin', { which: async () => [], exists: () => true, isCli: async () => false })).toBeNull()
  })
})

describe('loginShellPath (macOS)', () => {
  it("reads PATH between the markers from the user's login shell, with the CLAUDE* variables scrubbed", async () => {
    let call: { file: string; args: readonly string[]; timeout: number; env: NodeJS.ProcessEnv | undefined } | undefined
    const exec = async (file: string, args: readonly string[], timeout: number, env?: NodeJS.ProcessEnv): Promise<RunResult> => {
      call = { file, args, timeout, env }
      return ok('Welcome back!\n__AGENTDECK_PATH__/opt/homebrew/bin:/usr/bin__AGENTDECK_PATH__')
    }
    expect(await loginShellPath({ SHELL: '/bin/bash', CLAUDECODE: '1', HOME: '/Users/k' }, exec)).toBe('/opt/homebrew/bin:/usr/bin')
    expect(call?.file).toBe('/bin/bash')
    expect(call?.args[0]).toBe('-ilc')
    expect(call?.timeout).toBeLessThanOrEqual(3_000)
    expect(call?.env).toEqual({ HOME: '/Users/k', SHELL: '/bin/bash', DISABLE_AUTO_UPDATE: 'true' })
  })

  it('uses zsh when SHELL is missing or not an absolute path', async () => {
    const files: string[] = []
    const exec = async (file: string): Promise<RunResult> => {
      files.push(file)
      return ok('')
    }
    await loginShellPath({}, exec)
    await loginShellPath({ SHELL: 'fish' }, exec)
    expect(files).toEqual(['/bin/zsh', '/bin/zsh'])
  })

  it.each([
    ['a timeout', { code: null, stdout: '', stderr: '' }],
    ['no markers', ok('/usr/bin:/bin')],
    ['an empty PATH', ok('__AGENTDECK_PATH____AGENTDECK_PATH__')]
  ])('gives up quietly on %s', async (_, r) => {
    expect(await loginShellPath({}, async () => r)).toBeNull()
  })
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

  it.runIf(WIN)('settles on timeout even when a .cmd shim leaves a child holding the pipe (code review LOW-9)', async () => {
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

  it.runIf(WIN)('runs Windows tools by absolute path, never a bare name looked up in the cwd (security review LOW-6)', () => {
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
