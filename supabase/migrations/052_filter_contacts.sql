-- ============================================================
-- 052_filter_contacts.sql — server-side contact list filters
--
-- Extends the tag-only RPC from 025 so the Contacts page can
-- also filter by assigned agent (and "unassigned") without a
-- second round-trip. SECURITY INVOKER so existing RLS on
-- contacts / contact_tags still scopes the result.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts(
  p_tag_ids UUID[] DEFAULT NULL,
  p_assigned_to UUID[] DEFAULT NULL,
  p_include_unassigned BOOLEAN DEFAULT FALSE,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    WHERE (
      p_tag_ids IS NULL
      OR cardinality(p_tag_ids) = 0
      OR EXISTS (
        SELECT 1
        FROM contact_tags ct
        WHERE ct.contact_id = c.id
          AND ct.tag_id = ANY(p_tag_ids)
      )
    )
    AND (
      (
        (p_assigned_to IS NULL OR cardinality(p_assigned_to) = 0)
        AND NOT COALESCE(p_include_unassigned, FALSE)
      )
      OR (
        COALESCE(p_include_unassigned, FALSE)
        AND c.assigned_to IS NULL
      )
      OR (
        p_assigned_to IS NOT NULL
        AND cardinality(p_assigned_to) > 0
        AND c.assigned_to = ANY(p_assigned_to)
      )
    )
    AND (
      p_search IS NULL
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR c.email ILIKE '%' || p_search || '%'
    )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT) TO authenticated;
