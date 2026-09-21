import type { ExportContactRow } from "./export-csv";

const PAGE_SIZE = 500;
const MAX_ROWS = 10_000;
const ID_CHUNK = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface LoadExportContactsOpts {
  ids?: string[];
  tagIds?: string[];
  assignedTo?: string[];
  includeUnassigned?: boolean;
  search?: string | null;
}

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  created_at: string;
}

function hasFilters(opts: LoadExportContactsOpts): boolean {
  return Boolean(
    (opts.tagIds && opts.tagIds.length > 0) ||
      (opts.assignedTo && opts.assignedTo.length > 0) ||
      opts.includeUnassigned ||
      opts.search,
  );
}

async function fetchContactsByIds(db: Db, ids: string[]): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await db
      .from("contacts")
      .select("id, phone, name, email, company, created_at")
      .in("id", chunk)
      .order("created_at", { ascending: false });
    if (error) throw error;
    rows.push(...((data ?? []) as ContactRow[]));
    if (rows.length >= MAX_ROWS) break;
  }
  const wanted = new Set(ids);
  return rows.filter((row) => wanted.has(row.id)).slice(0, MAX_ROWS);
}

async function fetchFilteredContacts(
  db: Db,
  opts: LoadExportContactsOpts,
): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await db.rpc("filter_contacts", {
      p_tag_ids: opts.tagIds?.length ? opts.tagIds : null,
      p_assigned_to: opts.assignedTo?.length ? opts.assignedTo : null,
      p_include_unassigned: Boolean(opts.includeUnassigned),
      p_search: opts.search || null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) throw error;
    const page = (data ?? []) as { contact: ContactRow }[];
    if (page.length === 0) break;
    for (const row of page) {
      if (row.contact) rows.push(row.contact);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return rows.slice(0, MAX_ROWS);
}

async function fetchAllContacts(db: Db): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from("contacts")
      .select("id, phone, name, email, company, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as ContactRow[];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows.slice(0, MAX_ROWS);
}

async function tagsByContact(
  db: Db,
  contactIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (contactIds.length === 0) return map;

  for (let i = 0; i < contactIds.length; i += ID_CHUNK) {
    const chunk = contactIds.slice(i, i + ID_CHUNK);
    const { data, error } = await db
      .from("contact_tags")
      .select("contact_id, tags(name)")
      .in("contact_id", chunk);
    if (error) throw error;

    for (const row of (data ?? []) as Array<{
      contact_id: string;
      tags: { name: string } | { name: string }[] | null;
    }>) {
      const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
      const name = tag?.name?.trim();
      if (!name) continue;
      const list = map.get(row.contact_id) ?? [];
      if (!list.includes(name)) list.push(name);
      map.set(row.contact_id, list);
    }
  }
  return map;
}

export async function loadExportContacts(
  db: Db,
  opts: LoadExportContactsOpts,
): Promise<ExportContactRow[]> {
  let contacts: ContactRow[];
  if (opts.ids && opts.ids.length > 0) {
    contacts = await fetchContactsByIds(db, opts.ids);
  } else if (hasFilters(opts)) {
    contacts = await fetchFilteredContacts(db, opts);
  } else {
    contacts = await fetchAllContacts(db);
  }

  const tagMap = await tagsByContact(
    db,
    contacts.map((c) => c.id),
  );

  return contacts.map((c) => ({
    phone: c.phone,
    name: c.name,
    email: c.email,
    company: c.company,
    tags: tagMap.get(c.id) ?? [],
    createdAt: c.created_at,
  }));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuidList(
  raw: string | null,
  max = 500,
): { ids: string[]; invalid: boolean } {
  if (!raw?.trim()) return { ids: [], invalid: false };
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!UUID_RE.test(id)) return { ids: [], invalid: true };
    if (!ids.includes(id)) ids.push(id);
    if (ids.length > max) return { ids: [], invalid: true };
  }
  return { ids, invalid: false };
}
