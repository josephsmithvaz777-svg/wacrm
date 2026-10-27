import type { SupabaseClient } from '@supabase/supabase-js'

import { isAccountMediaPath } from '@/lib/storage/upload-media'

export const CLEANUP_DAY_OPTIONS = [30, 60, 90] as const
export type CleanupOlderThanDays = (typeof CLEANUP_DAY_OPTIONS)[number]

const REMOVE_BATCH = 100

export interface OldChatMediaObject {
  object_name: string
  bytes: number
  created_at: string
}

export interface MediaCleanupPreview {
  olderThanDays: CleanupOlderThanDays
  before: string
  files: number
  bytes: number
}

export function parseOlderThanDays(value: unknown): CleanupOlderThanDays | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (n === 30 || n === 60 || n === 90) return n
  return null
}

export function beforeIsoForDays(days: CleanupOlderThanDays, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
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
    if (!name) continue
    out.push({ object_name: name, bytes, created_at: created })
  }
  return out
}

export async function listOldChatMedia(
  db: SupabaseClient,
  accountId: string,
  beforeIso: string,
): Promise<OldChatMediaObject[]> {
  const { data, error } = await db.rpc('list_old_chat_media', {
    p_account_id: accountId,
    p_before: beforeIso,
  })
  if (error) {
    throw new Error(error.message)
  }
  return parseListed(data).filter((row) =>
    isAccountMediaPath(accountId, row.object_name),
  )
}

export function summarizeCleanup(
  rows: OldChatMediaObject[],
  olderThanDays: CleanupOlderThanDays,
  beforeIso: string,
): MediaCleanupPreview {
  return {
    olderThanDays,
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
