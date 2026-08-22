import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateConversation } from './find-or-create';

// ------------------------------------------------------------
// Chainable Supabase stub. `maybeSingle` answers the existence
// lookup; `single` answers the insert's RETURNING clause.
// ------------------------------------------------------------
function makeDb(script: {
  existing?: { id: string } | null;
  insertedId?: string;
  insertError?: { message: string };
}) {
  const inserted: Array<Record<string, unknown>> = [];

  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: script.existing ?? null, error: null }),
    insert(row: Record<string, unknown>) {
      inserted.push(row);
      return builder;
    },
    single: async () =>
      script.insertError
        ? { data: null, error: script.insertError }
        : { data: { id: script.insertedId ?? 'cv-new' }, error: null },
  };

  return {
    db: { from: () => builder } as unknown as SupabaseClient,
    inserted,
  };
}

describe('findOrCreateConversation', () => {
  it('returns the existing thread without inserting', async () => {
    const { db, inserted } = makeDb({ existing: { id: 'cv1' } });
    await expect(
      findOrCreateConversation(db, 'acct', 'user-1', 'contact-1'),
    ).resolves.toBe('cv1');
    expect(inserted).toEqual([]);
  });

  it('creates the thread when the contact has none', async () => {
    const { db, inserted } = makeDb({ existing: null, insertedId: 'cv2' });
    await expect(
      findOrCreateConversation(db, 'acct', 'user-1', 'contact-1'),
    ).resolves.toBe('cv2');
    expect(inserted).toEqual([
      { account_id: 'acct', user_id: 'user-1', contact_id: 'contact-1' },
    ]);
  });

  it('returns null when the insert fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = makeDb({
      existing: null,
      insertError: { message: 'permission denied' },
    });
    await expect(
      findOrCreateConversation(db, 'acct', 'user-1', 'contact-1'),
    ).resolves.toBeNull();
    spy.mockRestore();
  });
});
