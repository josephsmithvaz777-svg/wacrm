-- ============================================================
-- 069_filter_contacts_created_at.sql
--
-- Contacts list + admin CSV export need an inclusive created_at
-- window (campaign dumps like "agosto") without pulling the whole
-- book client-side. Adds p_created_from / p_created_to. The previous
-- 6-arg signature is dropped so PostgREST has a single overload.
-- ============================================================

DROP FUNCTION IF EXISTS public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts(
  p_tag_ids UUID[] DEFAULT NULL,
  p_assigned_to UUID[] DEFAULT NULL,
  p_include_unassigned BOOLEAN DEFAULT FALSE,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_created_from TIMESTAMPTZ DEFAULT NULL,
  p_created_to TIMESTAMPTZ DEFAULT NULL
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
    AND (p_created_from IS NULL OR c.created_at >= p_created_from)
    AND (p_created_to IS NULL OR c.created_at < p_created_to)
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

ALTER FUNCTION public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(UUID[], UUID[], BOOLEAN, TEXT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
