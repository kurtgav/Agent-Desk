import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'

/** The profile photo is kept as a square PNG this big, at most (Profile.avatar). */
export const AVATAR_PX = 256
/** A bigger file is refused: decoding it would cost memory for a picture shown at 72 px. */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024
/** What Electron's nativeImage can decode: it reads PNG and JPEG, not WebP. */
export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const

export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

/** The largest centred square of a `width` × `height` picture. */
export function squareCrop(width: number, height: number): Crop {
  const side = Math.min(width, height)
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }
}

/** Centre-cropped to a square, and shrunk (never enlarged) to AVATAR_PX. */
export function toSquare(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  const square = width === height ? image : image.crop(squareCrop(width, height))
  return square.getSize().width > AVATAR_PX ? square.resize({ width: AVATAR_PX, height: AVATAR_PX, quality: 'best' }) : square
}

const dataUrl = (image: NativeImage): string => `data:image/png;base64,${image.toPNG().toString('base64')}`

export type SaveResult = { ok: true } | { ok: false; error: string }

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export interface AvatarStore {
  /** The photo as a data URL, or null when there is none or the file can't be used (a damaged file never throws). */
  read(): Promise<string | null>
  /** Shrinks the picture in `file` into the store, replacing any earlier photo atomically. */
  save(file: string): Promise<SaveResult>
  clear(): Promise<void>
}

/** `<userData>/profile/avatar.png`. A larger file put there by hand is shrunk in memory on every read and left as it is. */
export function avatarStore(userData: string): AvatarStore {
  const dir = join(userData, 'profile')
  const file = join(dir, 'avatar.png')
  let cached: { key: string; url: string | null } | null = null

  return {
    async read() {
      try {
        const s = await stat(file)
        if (!s.isFile() || s.size > AVATAR_MAX_BYTES) return null
        const key = `${s.mtimeMs}:${s.size}`
        if (cached?.key === key) return cached.url
        const image = nativeImage.createFromBuffer(await readFile(file))
        const url = image.isEmpty() ? null : dataUrl(toSquare(image))
        cached = { key, url }
        return url
      } catch {
        return null
      }
    },

    async save(source) {
      if (!(AVATAR_EXTENSIONS as readonly string[]).includes(extname(source).slice(1).toLowerCase())) {
        return { ok: false, error: 'Pick a PNG or JPEG picture.' }
      }
      try {
        const s = await stat(source)
        if (!s.isFile()) return { ok: false, error: 'That is not a picture file.' }
        if (s.size > AVATAR_MAX_BYTES) return { ok: false, error: 'That picture is larger than 10 MB. Pick a smaller one.' }
        const image = nativeImage.createFromBuffer(await readFile(source))
        if (image.isEmpty()) return { ok: false, error: 'AgentDeck could not read that picture. Pick a PNG or JPEG.' }
        await mkdir(dir, { recursive: true })
        const tmp = `${file}.tmp`
        await writeFile(tmp, toSquare(image).toPNG())
        await rename(tmp, file)
        cached = null
        return { ok: true }
      } catch (e) {
        await rm(`${file}.tmp`, { force: true }).catch(() => undefined)
        return { ok: false, error: `AgentDeck could not save the picture: ${message(e)}` }
      }
    },

    async clear() {
      cached = null
      await rm(file, { force: true })
    }
  }
}
