import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { run } from '../collector/cli'
import { killProcessTree } from './console-proc'

vi.mock('../collector/cli', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../collector/cli')>()),
  run: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
}))

const child = (pid: number | undefined): ChildProcess => ({ pid, kill: vi.fn() }) as unknown as ChildProcess

describe('killProcessTree', () => {
  it('macOS: SIGTERM to the process group the console was spawned as, then the child itself', () => {
    const kill = vi.fn(() => true) as unknown as typeof process.kill
    const c = child(4242)
    killProcessTree(c, 'darwin', kill)
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM')
    expect(c.kill).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('macOS: a group that is gone already is not an error', () => {
    const c = child(7)
    const kill = vi.fn(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    }) as unknown as typeof process.kill
    expect(() => killProcessTree(c, 'darwin', kill)).not.toThrow()
    expect(c.kill).toHaveBeenCalledTimes(1)
  })

  it('a child that never started (no pid) is only asked to stop', () => {
    const kill = vi.fn() as unknown as typeof process.kill
    const c = child(undefined)
    killProcessTree(c, 'darwin', kill)
    expect(kill).not.toHaveBeenCalled()
    expect(c.kill).toHaveBeenCalledTimes(1)
  })

  it('Windows: taskkill /T for the tree, no process-group signal', () => {
    const kill = vi.fn() as unknown as typeof process.kill
    killProcessTree(child(4242), 'win32', kill)
    expect(vi.mocked(run).mock.lastCall![0]).toMatch(/taskkill\.exe$/)
    expect(vi.mocked(run).mock.lastCall![1]).toEqual(['/PID', '4242', '/T', '/F'])
    expect(kill).not.toHaveBeenCalled()
  })
})
