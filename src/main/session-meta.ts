// Local notes about sessions (pinned, unread, a display name, archived, a section) in config.json. They are AgentDeck's own
// and never touch Claude Code's files. No electron import: unit-testable.
import { z } from 'zod'
import { IPC } from '@shared/bridge'
import {
  EMPTY_META, SectionOpSchema, SessionMetaPatchSchema, applyPatch, applySectionOp, readMeta, setRole, toConfig, touch, type SessionMetaResult, type SessionMetaState
} from '@shared/session-meta'
import { readConfig, updateConfig } from './config'
import type { Dispose, MainCtx } from './ctx'
import { wasWritten } from './settings-model'

const DEMO_SAVED: SessionMetaResult = { ok: false, error: 'Demo data: nothing was saved.' }
const SessionId = z.string().min(1).max(128)
const SessionIds = z.array(SessionId).max(500)

/** What config.json holds, checked and pruned. A damaged file reads as no notes. */
export function loadMeta(file: string, now: number): SessionMetaState {
  const c = readConfig(file)
  return readMeta({ sessionMeta: c.sessionMeta, sections: c.sections }, now)
}

/** Writes the two keys (every other key stays) and reads them back before the window is told it worked (D-136). */
export function saveMeta(file: string, state: SessionMetaState): SessionMetaResult {
  const changes = toConfig(state)
  updateConfig(file, changes)
  return wasWritten(changes, readConfig(file)) ? { ok: true, state } : { ok: false, error: 'AgentDeck could not write config.json. Check that its folder is not read-only, then try again.' }
}

/** One change: read, apply, write. Main handles one message at a time and the file is read synchronously, so changes never interleave. */
export function changeMeta(file: string, now: number, fn: (state: SessionMetaState) => SessionMetaResult): SessionMetaResult {
  const r = fn(loadMeta(file, now))
  return r.ok ? saveMeta(file, r.state) : r
}

/** Notes the role of sessions AgentDeck started, under each key (a session id, or the name or id of a background session). */
export function noteRole(file: string, keys: readonly string[], role: string, now: number): void {
  changeMeta(file, now, (state) => ({ ok: true, state: setRole(state, keys, role, now) }))
}

export function registerSessionMeta(ctx: MainCtx): Dispose {
  // Demo keeps its notes in the window's memory only (ADR-0011): nothing here is read or written.
  const guarded = (fn: (now: number) => SessionMetaResult): SessionMetaResult => (ctx.demo() ? DEMO_SAVED : fn(Date.now()))

  ctx.handle(IPC.getSessionMeta, (): SessionMetaState => (ctx.demo() ? EMPTY_META : loadMeta(ctx.configFile(), Date.now())))
  ctx.handle(IPC.setSessionMeta, (_e, id, patch) => {
    const sessionId = SessionId.parse(id)
    const valid = SessionMetaPatchSchema.parse(patch)
    return guarded((now) => changeMeta(ctx.configFile(), now, (state) => applyPatch(state, sessionId, valid, now)))
  })
  ctx.handle(IPC.setSections, (_e, op) => {
    const valid = SectionOpSchema.parse(op)
    return guarded((now) => changeMeta(ctx.configFile(), now, (state) => applySectionOp(state, valid, now)))
  })
  ctx.handle(IPC.touchSessions, (_e, ids) => {
    const listed = SessionIds.parse(ids)
    if (ctx.demo()) return
    const now = Date.now()
    const state = loadMeta(ctx.configFile(), now)
    const next = touch(state, listed, now)
    if (next !== state) saveMeta(ctx.configFile(), next)
  })
  return () => {}
}
