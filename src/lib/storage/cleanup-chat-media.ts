import type { SupabaseClient } from '@supabase/supabase-js'

import { isAccountMediaPath } from '@/lib/storage/upload-media'

export const CLEANUP_DAY_OPTIONS = [7, 14, 30, 60, 90] as const
export type CleanupOlderThanDays = (typeof CLEANUP_DAY_OPTIONS)[number]

/** Special scope: everything before the 1st of the current UTC month. */
export const CLEANUP_BEFORE_MONTH = 'before_month' as const
export type CleanupAgeScope = CleanupOlderThanDays | typeof CLEANUP_BEFORE_MONTH

export const CLEANUP_KIND_OPTIONS = [
  'all',
  'video',
  'image',
  'audio',
  'document',
] as const
export type CleanupMediaKind = (typeof CLEANUP_KIND_OPTIONS)[number]

const REMOVE_BATCH = 100

export interface OldChatMediaObject {
  object_name: string
  bytes: number
  created_at: string
  mime: string
}

export interface MediaCleanupPreview {
  age: CleanupAgeScope
  kind: CleanupMediaKind
  before: string
  files: number
  bytes: number
}

export function parseOlderThanDays(value: unknown): CleanupOlderThanDays | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (
    n === 7 ||
    n === 14 ||
    n === 30 ||
    n === 60 ||
    n === 90
  ) {
    return n
  }
  return null
}

export function parseAgeScope(value: unknown): CleanupAgeScope | null {
  if (value === CLEANUP_BEFORE_MONTH || value === 'before_month') {
    return CLEANUP_BEFORE_MONTH
  }
  return parseOlderThanDays(value)
}

export function parseMediaKind(value: unknown): CleanupMediaKind | null {
  if (
    typeof value === 'string' &&
    (CLEANUP_KIND_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as CleanupMediaKind
  }
  return null
}

export function beforeIsoForDays(days: CleanupOlderThanDays, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** Start of the current month in UTC (exclusive cutoff = files created before this). */
export function beforeIsoForMonthStart(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString()
}

export function beforeIsoForAge(age: CleanupAgeScope, now = new Date()): string {
  if (age === CLEANUP_BEFORE_MONTH) return beforeIsoForMonthStart(now)
  return beforeIsoForDays(age, now)
}

export function mimeMatchesKind(mime: string, kind: CleanupMediaKind): boolean {
  if (kind === 'all') return true
  const m = (mime || '').toLowerCase()
  if (kind === 'video') return m.startsWith('video/')
  if (kind === 'image') return m.startsWith('image/')
  if (kind === 'audio') return m.startsWith('audio/')
  // documents + unknown non av
  return (
    !m.startsWith('video/') &&
    !m.startsWith('image/') &&
    !m.startsWith('audio/')
  )
}

function parseListed(rows: unknown): OldChatMediaObject[] {
  if (!Array.isArray(rows)) return []
  const out: OldChatMediaObject[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const name = typeof r.object_name === 'string' ? r.object_name : ''
    const bytes = typeof r.bytes === 'number' ? r.bytes : Number(r.bytes) || 0
    const created =
      typeof r.created_at === 'string' ? r.created_at : new Date().toISOString()
    const mime = typeof r.mime === 'string' ? r.mime : ''
    if (!name) continue
    out.push({ object_name: name, bytes, created_at: created, mime })
  }
  return out
}

export async function listOldChatMedia(
  db: SupabaseClient,
  accountId: string,
  beforeIso: string,
  kind: CleanupMediaKind = 'all',
): Promise<OldChatMediaObject[]> {
  const { data, error } = await db.rpc('list_old_chat_media', {
    p_account_id: accountId,
    p_before: beforeIso,
  })
  if (error) {
    throw new Error(error.message)
  }
  return parseListed(data)
    .filter((row) => isAccountMediaPath(accountId, row.object_name))
    .filter((row) => mimeMatchesKind(row.mime, kind))
}

export function summarizeCleanup(
  rows: OldChatMediaObject[],
  age: CleanupAgeScope,
  kind: CleanupMediaKind,
  beforeIso: string,
): MediaCleanupPreview {
  return {
    age,
    kind,
    before: beforeIso,
    files: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
  }
}

export async function deleteOldChatMedia(
  db: SupabaseClient,
  accountId: string,
  rows: OldChatMediaObject[],
): Promise<{ deleted: number; failed: number }> {
  const paths = rows
    .map((row) => row.object_name)
    .filter((path) => isAccountMediaPath(accountId, path))

  let deleted = 0
  let failed = 0
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH)
    const { error } = await db.storage.from('chat-media').remove(batch)
    if (error) {
      console.error('[media-cleanup] remove failed:', error.message)
      failed += batch.length
      continue
    }
    deleted += batch.length
  }
  return { deleted, failed }
}
