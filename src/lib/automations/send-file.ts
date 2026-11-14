// Send-file step config. The URL points at a file the account already
// hosts (their VPS). WAHA or Meta downloads it at send time. This app
// never stores the bytes.

export const SEND_FILE_KINDS = ['image', 'video', 'document'] as const
export type SendFileKind = (typeof SEND_FILE_KINDS)[number]

export interface ParsedSendFile {
  url: string
  kind: SendFileKind
  caption: string
  filename: string | null
}

const MAX_URL_LENGTH = 2048
const MAX_CAPTION_LENGTH = 1024
const MAX_FILENAME_LENGTH = 120

export function isSendFileKind(value: unknown): value is SendFileKind {
  return typeof value === 'string' && (SEND_FILE_KINDS as readonly string[]).includes(value)
}

/**
 * http(s) URL only. Private hosts are allowed on purpose: WAHA, not
 * this server, fetches the file, and the file often lives on the same
 * VPS. Credentials in the URL are rejected so they are not saved in
 * step_config.
 */
export function isExternalMediaUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (!url.hostname) return false
  if (url.username || url.password) return false
  return true
}

export function parseSendFileConfig(
  cfg: Record<string, unknown> | null | undefined,
): { ok: true; value: ParsedSendFile } | { ok: false; message: string } {
  const c = cfg ?? {}
  const url = typeof c.url === 'string' ? c.url.trim() : ''
  if (!url) return { ok: false, message: 'file URL is required' }
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, message: 'file URL is too long' }
  }
  if (!isExternalMediaUrl(url)) {
    return { ok: false, message: 'file URL must be an http(s) link without a password' }
  }
  if (!isSendFileKind(c.kind)) {
    return { ok: false, message: 'file kind must be image, video, or document' }
  }
  const caption = typeof c.caption === 'string' ? c.caption : ''
  if (caption.length > MAX_CAPTION_LENGTH) {
    return { ok: false, message: 'file caption is too long' }
  }
  let filename: string | null = null
  if (typeof c.filename === 'string' && c.filename.trim()) {
    filename = c.filename.trim()
    if (filename.length > MAX_FILENAME_LENGTH || /[\\/]/.test(filename)) {
      return { ok: false, message: 'file name is invalid' }
    }
  }
  return { ok: true, value: { url, kind: c.kind, caption, filename } }
}
