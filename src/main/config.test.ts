import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readConfig, readJson, updateConfig, writeJson } from './config'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-cfg-'))
  file = join(dir, 'config.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readJson / writeJson', () => {
  test('missing and corrupt files read as undefined', () => {
    expect(readJson(file)).toBeUndefined()
    writeFileSync(file, '{not json')
    expect(readJson(file)).toBeUndefined()
  })

  test('round-trips and leaves no temp file behind', () => {
    writeJson(file, { a: 1 })
    expect(readJson(file)).toEqual({ a: 1 })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})

describe('config.json', () => {
  test('corrupt or non-object config reads as empty', () => {
    writeFileSync(file, '[1,2]')
    expect(readConfig(file)).toEqual({})
    writeFileSync(file, '\u0000garbage')
    expect(readConfig(file)).toEqual({})
  })

  test('updateConfig merges and keeps keys it does not know about', () => {
    writeFileSync(file, JSON.stringify({ token: 'abc', trayHintShown: false }))
    updateConfig(file, { trayHintShown: true })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ token: 'abc', trayHintShown: true })
  })

  test('updateConfig starts fresh over a corrupt file', () => {
    writeFileSync(file, '{oops')
    updateConfig(file, { autostartConfigured: true })
    expect(readConfig(file)).toEqual({ autostartConfigured: true })
  })
})
