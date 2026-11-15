import { IMAGE_TYPES, type ConsoleImage, type ImageType } from '@shared/console'

/** Raw size cap per picture: base64 adds a third, so this stays under main's IMAGE_BASE64_MAX. */
export const IMAGE_BYTES_MAX = 3.5 * 1024 * 1024

const isImageType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t)

/** The picture files on a paste or drop (a screenshot on the clipboard arrives as a file item). */
export const imageFiles = (data: DataTransfer | null): File[] =>
  [...(data?.items ?? [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).flatMap((i) => i.getAsFile() ?? [])

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error)
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })

export interface ReadImages {
  images: ConsoleImage[]
  /** Plain words for what was left out (wrong type or too big), or null. */
  skipped: string | null
}

export async function readImages(files: readonly File[]): Promise<ReadImages> {
  const images: ConsoleImage[] = []
  let wrongType = 0
  let tooBig = 0
  for (const f of files) {
    if (!isImageType(f.type)) wrongType++
    else if (f.size > IMAGE_BYTES_MAX) tooBig++
    else {
      const data = await toBase64(f).catch(() => '')
      if (data) images.push({ mediaType: f.type, data })
    }
  }
  const parts = [wrongType ? `${wrongType} not PNG, JPEG, GIF or WebP` : '', tooBig ? `${tooBig} over 3.5 MB` : ''].filter(Boolean)
  return { images, skipped: parts.length ? `Left out: ${parts.join(', ')}.` : null }
}
