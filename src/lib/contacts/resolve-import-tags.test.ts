import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveImportTagIds } from './resolve-import-tags';

interface ExistingTag {
  id: string;
  name: string;
}

function fakeDb(existing: ExistingTag[]) {
  const created: { name: string }[] = [];
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: existing, error: null });
            },
          };
        },
        insert(rows: { name: string }[]) {
          created.push(...rows);
          return {
            select() {
              return Promise.resolve({
                data: rows.map((row, index) => ({
                  id: `new-${index}`,
                  name: row.name,
                })),
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, created };
}

const params = {
  accountId: 'account-1',
  userId: 'user-1',
  canCreateTags: true,
};

describe('resolveImportTagIds', () => {
  it('returns only the requested tags, not every tag on the account', async () => {
    const { db, created } = fakeDb([
      { id: 't1', name: 'Interesado' },
      { id: 't2', name: 'FORM TOUR VIRU' },
      { id: 't3', name: 'Jimena' },
    ]);

    const { tagIdByKey, skippedNames } = await resolveImportTagIds(db, {
      ...params,
      tagNames: ['form tour viru', 'Lead sheet'],
    });

    expect([...tagIdByKey.entries()]).toEqual([
      ['form tour viru', 't2'],
      ['lead sheet', 'new-0'],
    ]);
    expect(skippedNames).toEqual([]);
    expect(created.map((row) => row.name)).toEqual(['Lead sheet']);
  });

  it('skips unknown names when it cannot create tags', async () => {
    const { db, created } = fakeDb([{ id: 't1', name: 'Formulario' }]);

    const { tagIdByKey, skippedNames } = await resolveImportTagIds(db, {
      ...params,
      canCreateTags: false,
      tagNames: ['Formulario', 'Nueva'],
    });

    expect([...tagIdByKey.entries()]).toEqual([['formulario', 't1']]);
    expect(skippedNames).toEqual(['Nueva']);
    expect(created).toEqual([]);
  });
});
