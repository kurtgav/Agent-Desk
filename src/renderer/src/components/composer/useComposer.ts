import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { RoleSummary } from '@shared/roles'
import { useUi } from '@/store'
import { dispatchTask } from '@/lib/act'
import { cliProblem, useClaudeLink } from '@/lib/claudeLink'
import { projectName, recentProjects } from '@/lib/selectors'
import { useCaps } from '../console/caps-store'
import { IMAGES_MAX, type ConsoleImage } from '@shared/console'
import { NEW, addImages, connectConsole, isRunning, removeImage, setText as setConsoleText, stopConversation, submit, useConsole } from '../console/store'
import { readImages } from './pasteImages'
import { useDrafts } from './drafts'
import { editRange } from './MentionField'
import { composerKey } from './keys'
import { addMention, diffEdit, dropMentions, insertMention, keepOnly, makeLead, mentionIds, parseMentions, removeRanges, swapMention, unitDelete, type Edit } from './mentions'
import { overLimit, planBackground, planSend } from './plan'
import { variantOf, type ComposerProps } from './props'
import type { PickerMode } from './RolePicker'
import type { SendProblem } from './Notices'
import { applyCompletion } from './slash'
import { useSuggestions } from './Suggestions'
import { HELPERS_MAX, MENTIONS_MAX } from './types'
import { useMenus } from './useMenus'
import { useRoleIndex } from './useRoleIndex'

const NO_IMAGES: ConsoleImage[] = []

/** What the user is told when a message is already as full of agents as it can be. */
const limitNote = (variant: 'new-session' | 'reply', name: string): string =>
  `That is the most agents for one ${variant === 'reply' ? 'message' : 'session'}: a lead and ${HELPERS_MAX} helpers. Take one out to add ${name}.`

/**
 * Everything the composer does, for any variant: where its text lives, which agents the text mentions, what the menus offer, what
 * a send is and why it can not be one, and the edits the chips and menus make to the text. The view only draws it.
 */
export function useComposer(props: ComposerProps) {
  const variant = variantOf(props)
  const convId = props.variant === 'reply' ? props.conversationId : null
  const key = variant === 'task' ? 'task' : (convId ?? NEW)
  const ix = useRoleIndex()
  const recent = useUi((s) => s.recentRoles)

  // The text: a new session's and each conversation's draft live in the Console's store, a task's in drafts.ts. Memory only.
  const consoleText = useConsole((s) => s.texts[key] ?? '')
  const taskText = useDrafts((s) => s.task)
  const text = variant === 'task' ? taskText : consoleText
  const setText = useCallback(
    (t: string): void => {
      if (variant === 'task') useDrafts.getState().setTask(t)
      else setConsoleText(key, t)
    },
    [variant, key]
  )
  const readText = (): string => (variant === 'task' ? useDrafts.getState().task : (useConsole.getState().texts[key] ?? ''))

  const images = useConsole((s) => s.images[key]) ?? NO_IMAGES
  const pasteImages = async (files: File[]): Promise<void> => {
    const read = await readImages(files)
    const over = addImages(key, read.images)
    setFlash(over ? `Up to ${IMAGES_MAX} images per message. ${over} left out.` : read.skipped)
  }

  const view = useConsole((s) => (convId ? s.convs[convId] : undefined))
  const draft = useConsole((s) => s.draft)
  const starting = useConsole((s) => s.starting)
  const startProblem = useConsole((s) => s.startProblem)
  const focusTick = useConsole((s) => s.focusTick)
  const lastCaps = useCaps((s) => s.last)
  const snapshot = useUi((s) => s.snapshot)
  const link = useClaudeLink()
  const cli = variant === 'new-session' ? cliProblem(link) : null
  const running = isRunning(view)
  const over = view !== undefined && (view.thread.state === 'ended' || view.thread.state === 'failed')
  const cwd = variant === 'task' ? ((props.variant === 'task' && props.project) || null) : (draft.cwd ?? recentProjects(snapshot, 1)[0]?.cwd ?? null)

  const spans = useMemo(() => parseMentions(text, ix.has), [text, ix])
  const ids = useMemo(() => mentionIds(spans), [spans])
  const plan = useMemo(() => planSend(variant, text, spans, ix.lookup), [variant, text, spans, ix])
  const background = useMemo(() => (variant === 'new-session' ? planBackground(text, spans, ix.lookup) : null), [variant, text, spans, ix])

  const el = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const [caret, setCaret] = useState(0)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [problem, setProblem] = useState<SendProblem | null>(null)
  const [picker, setPicker] = useState<PickerMode | null>(null)
  // A menu belongs to the box while it has the focus: clicking elsewhere closes it, coming back opens it again.
  const [focused, setFocused] = useState(false)
  const menus = useMenus({ text, caret, focused, slash: variant !== 'task', caps: view?.thread.capabilities ?? lastCaps, roles: ix, recent })
  const suggested = useSuggestions(removeRanges(text, spans.map((s): [number, number] => [s.start, s.end])).text, variant !== 'reply', ix, ids)

  // Typing a sixth handle in full is a sixth mention too: say so as it happens, not only when Enter is refused.
  const overLimitNote = overLimit(variant, ids.length)
  const working = busy || (variant === 'new-session' && starting)
  const blocked = working
    ? variant === 'task' ? 'Adding the task…' : variant === 'reply' ? 'Sending…' : 'Starting the conversation…'
    : (cli?.hint ?? (variant === 'new-session' && !cwd ? 'Pick a project first' : null) ?? (plan.ok ? null : plan.reason))

  useEffect(() => {
    if (variant === 'task') return
    // Once per window: the conversations, and the commands and skills the `/` menu lists, are the Console's to load.
    connectConsole()
    el.current?.focus()
  }, [focusTick, convId, variant])
  // After an edit the browser could not make itself, the caret goes where the edit says (the text changes first, then this runs).
  useEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    el.current?.setSelectionRange(at, at)
  }, [text])

  const applyEdit = (next: Edit): void => {
    const d = diffEdit(readText(), next.text)
    // As the browser's own edit when it will: undo and redo then treat a mention like typing.
    if (editRange(el.current, d.from, d.to, d.insert)) el.current?.setSelectionRange(next.caret, next.caret)
    else {
      setText(next.text)
      pendingCaret.current = next.caret
    }
    setCaret(next.caret)
    setFlash(null)
    el.current?.focus()
  }

  /** Writes the agent into the message: swapped in for a task, refused with the reason at the limit, else added. */
  const addRole = (role: RoleSummary): void => {
    if (ids.includes(role.id)) return void el.current?.focus()
    if (variant === 'task' && spans.length) return applyEdit(swapMention(text, spans, 0, role.id))
    if (variant !== 'task' && ids.length >= MENTIONS_MAX[variant]) return setFlash(limitNote(variant, role.name))
    applyEdit(addMention(text, spans, role.id))
  }

  const pickMention = (role: RoleSummary): void => {
    const t = menus.trigger
    if (!t) return
    if (variant !== 'task' && !ids.includes(role.id) && ids.length >= MENTIONS_MAX[variant]) {
      setFlash(limitNote(variant, role.name))
      return menus.dismiss()
    }
    // Only what was typed up to the caret is replaced: a word glued on after it stays, with a space put between.
    const edit = insertMention(text, { start: t.start, end: caret }, role.id)
    if (variant === 'task') {
      const after = parseMentions(edit.text, ix.has)
      applyEdit(keepOnly(edit.text, after, role.id))
    } else applyEdit(edit)
  }

  const pickAt = (i?: number): void => {
    const role = menus.mentionAt(i)
    if (role) return pickMention(role)
    const item = menus.slashAt(i)
    if (item && menus.trigger) applyEdit(applyCompletion(text, menus.trigger, item))
  }

  const chips = {
    onRemove: (id: string): void => applyEdit({ text: dropMentions(text, spans, (s) => s.id === id), caret: Math.min(caret, text.length) }),
    onLead: (id: string): void => applyEdit(makeLead(text, spans, id)),
    onChange: (id: string): void => setPicker({ kind: 'change', id }),
    onAdd: (): void => setPicker({ kind: 'add' })
  }
  const pickFromPicker = (role: RoleSummary): void => {
    const mode = picker
    setPicker(null)
    if (mode?.kind === 'change') {
      const at = spans.findIndex((s) => s.id === mode.id)
      applyEdit(swapMention(text, spans, Math.max(0, at), role.id))
    } else addRole(role)
    el.current?.focus()
  }

  const clearIfUnchanged = (sent: string): void => {
    if (readText() === sent) setText('')
  }
  const remember = (list: readonly string[]): void => {
    const { rememberRole } = useUi.getState()
    ;[...list].reverse().forEach(rememberRole)
  }

  const send = async (): Promise<void> => {
    if (blocked) return void (working ? undefined : setFlash(blocked))
    if (!plan.ok) return
    setFlash(null)
    setProblem(null)
    if (plan.kind === 'new-session') {
      const r = await submit({ conversation: null, text: plan.prompt, role: plan.role, helpers: plan.helpers })
      if (r.ok) {
        remember(ids)
        if (props.variant !== 'reply' && props.variant !== 'task') props.onStarted?.(r.id)
      }
    } else if (plan.kind === 'reply' && convId) {
      setBusy(true)
      const r = await submit({ conversation: convId, text: plan.text, mentions: plan.mentions })
      setBusy(false)
      if (r.ok) remember(ids)
      else setProblem({ message: r.error })
    } else if (plan.kind === 'task' && props.variant === 'task') {
      const sent = text
      setBusy(true)
      const ok = await props.onAdd({ title: plan.title, project: props.project, role: plan.role })
      setBusy(false)
      if (ok) {
        clearIfUnchanged(sent)
        remember(ids)
        el.current?.focus()
      }
    }
  }

  /** `claude --bg`: the lead is `--agent`, so it has to be installed in Claude Code. The reason it can not run is in the button's words. */
  const runInBackground = async (): Promise<void> => {
    if (background && !background.ok) return setFlash(background.reason)
    if (!background || working) return
    if (cli) return setFlash(cli.hint)
    if (!cwd) return setFlash('Pick a project first')
    const sent = text
    setFlash(null)
    setProblem(null)
    setBusy(true)
    const r = await dispatchTask({ prompt: background.prompt, cwd, agent: background.agent, effort: draft.effort, model: draft.model })
    setBusy(false)
    if (!r) return // demo: the notice has said nothing was sent, and the text stays
    if (r.ok) {
      clearIfUnchanged(sent)
      remember(ids)
      useUi.getState().notify(`Started ${r.name} in ${projectName(cwd)}.`)
    } else setProblem({ message: r.error, ...(r.untrusted ? { untrustedIn: cwd } : {}) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const whole = menus.kind === 'slash' && menus.listed && menus.trigger?.query.toLowerCase() === menus.slashAt()?.name.toLowerCase()
    const act = composerKey(
      { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, composing: e.nativeEvent.isComposing || e.keyCode === 229 },
      { menu: !menus.open ? 'none' : menus.listed ? 'listed' : 'note', whole: whole === true, singleLine: variant === 'task', running }
    )
    if (!act) return
    if (act === 'delete-back' || act === 'delete-forward') {
      const box = e.currentTarget
      const range = unitDelete(box.value, parseMentions(box.value, ix.has), box.selectionStart, box.selectionEnd, act === 'delete-back' ? 'back' : 'forward')
      if (!range) return
      e.preventDefault()
      if (!editRange(box, range[0], range[1], '')) applyEdit({ text: box.value.slice(0, range[0]) + box.value.slice(range[1]), caret: range[0] })
      return
    }
    e.preventDefault()
    if (act === 'send') void send()
    else if (act === 'menu-down') menus.move(1)
    else if (act === 'menu-up') menus.move(-1)
    else if (act === 'menu-page-down') menus.setActive(Math.min(menus.count - 1, menus.index + 6))
    else if (act === 'menu-page-up') menus.setActive(Math.max(0, menus.index - 6))
    else if (act === 'menu-pick') pickAt()
    else if (act === 'menu-dismiss') {
      e.stopPropagation()
      menus.dismiss()
    } else if (act === 'stop' && convId) void stopConversation(convId)
  }

  // "Start as this role" on the Agents page leaves the agent in the store: it becomes the lead of the next session or task.
  const role = useUi((s) => s.role)
  useEffect(() => {
    if (!role || variant === 'reply' || !ix.ready) return
    useUi.getState().setRole(null)
    const found = ix.get(role)
    if (!found) return
    const now = readText()
    const next = makeLead(now, parseMentions(now, ix.has), found.id)
    setText(next.text)
    pendingCaret.current = next.caret
    setCaret(next.caret)
    el.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readText and setText only read the store
  }, [role, variant, ix])

  return {
    images, pasteImages, dropImage: (i: number): void => removeImage(key, i),
    variant, convId, ix, text, spans, ids, plan, el, caret, menus, suggested, picker, flash, problem, cli, view, over, running, working, blocked, overLimitNote, cwd, draft, startProblem, background,
    setCaret, setFocused, setPicker, setProblem, setFlash, setText, onKeyDown, send, runInBackground, pickAt, pickMention, addRole, chips, pickFromPicker, recent,
    onValue: (t: string): void => {
      setText(t)
      setFlash(null)
    }
  }
}

export type Model = ReturnType<typeof useComposer>
