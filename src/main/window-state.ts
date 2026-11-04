// Pure window-geometry logic (no electron runtime import, so vitest can load it).

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  bounds: Rect
  maximized: boolean
}

export const MIN_WIDTH = 1200
export const MIN_HEIGHT = 760
export const DEFAULT_WIDTH = 1440
export const DEFAULT_HEIGHT = 924
const TITLE_BAR_HEIGHT = 48
/** How much of the title bar must be on a work area for the user to grab it. */
const MIN_GRAB_WIDTH = 100

/** 1440×924 (never below the minimum, never wider than the work area) centred on `workArea`. */
export function defaultBounds(workArea: Rect): Rect {
  const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, workArea.width))
  const height = Math.max(MIN_HEIGHT, Math.min(DEFAULT_HEIGHT, workArea.height))
  return {
    x: workArea.x + Math.max(0, Math.round((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.round((workArea.height - height) / 2)),
    width,
    height
  }
}

/**
 * Turns whatever was read from window-state.json into bounds to open with.
 * Falls back to the default when the file is missing/corrupt or when the saved
 * title bar is not reachable on any current display (monitor unplugged, resolution changed).
 */
export function resolveWindowState(saved: unknown, workAreas: Rect[], primaryWorkArea: Rect): WindowState {
  const fallback = defaultBounds(primaryWorkArea)
  if (!isRecord(saved) || !isRect(saved.bounds)) return { bounds: fallback, maximized: false }

  const maximized = saved.maximized === true
  const bounds = {
    x: Math.round(saved.bounds.x),
    y: Math.round(saved.bounds.y),
    width: Math.max(MIN_WIDTH, Math.round(saved.bounds.width)),
    height: Math.max(MIN_HEIGHT, Math.round(saved.bounds.height))
  }
  const reachable = workAreas.some((area) => titleBarVisible(bounds, area))
  return { bounds: reachable ? bounds : fallback, maximized }
}

function titleBarVisible(r: Rect, area: Rect): boolean {
  const w = Math.min(r.x + r.width, area.x + area.width) - Math.max(r.x, area.x)
  const h = Math.min(r.y + TITLE_BAR_HEIGHT, area.y + area.height) - Math.max(r.y, area.y)
  return w >= MIN_GRAB_WIDTH && h >= TITLE_BAR_HEIGHT / 2
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isRect(v: unknown): v is Rect {
  return (
    isRecord(v) &&
    [v.x, v.y, v.width, v.height].every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}
