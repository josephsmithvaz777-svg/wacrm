-- ============================================================
-- 073_delete_old_chat_media.sql
-- Admin cleanup deletes chat-media via SQL using the official
-- storage.allow_delete_query flag (Storage API was a no-op here).
-- Service-role only; the API route still checks admin role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_old_chat_media(
  p_account_id uuid,
  p_before timestamptz,
  p_kind text DEFAULT 'all'
)
RETURNS TABLE(deleted integer, bytes_freed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = storage, public
AS $$
DECLARE
  v_deleted integer := 0;
  v_bytes bigint := 0;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('all', 'video', 'image', 'audio', 'document') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;

  PERFORM set_config('storage.allow_delete_query', 'true', true);

  WITH doomed AS (
    SELECT o.id, COALESCE((o.metadata->>'size')::bigint, 0) AS sz
    FROM storage.objects o
    WHERE o.bucket_id = 'chat-media'
      AND o.name LIKE ('account-' || p_account_id::text || '/%')
      AND o.created_at < p_before
      AND (
        p_kind = 'all'
        OR (p_kind = 'video' AND COALESCE(o.metadata->>'mimetype','') LIKE 'video/%')
        OR (p_kind = 'image' AND COALESCE(o.metadata->>'mimetype','') LIKE 'image/%')
        OR (p_kind = 'audio' AND COALESCE(o.metadata->>'mimetype','') LIKE 'audio/%')
        OR (
          p_kind = 'document'
          AND COALESCE(o.metadata->>'mimetype','') NOT LIKE 'video/%'
          AND COALESCE(o.metadata->>'mimetype','') NOT LIKE 'image/%'
          AND COALESCE(o.metadata->>'mimetype','') NOT LIKE 'audio/%'
        )
      )
  ),
  removed AS (
    DELETE FROM storage.objects o
    USING doomed d
    WHERE o.id = d.id
    RETURNING d.sz
  )
  SELECT count(*)::integer, COALESCE(sum(sz), 0)
  INTO v_deleted, v_bytes
  FROM removed;

  deleted := v_deleted;
  bytes_freed := v_bytes;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_old_chat_media(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_old_chat_media(uuid, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.delete_old_chat_media(uuid, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_old_chat_media(uuid, timestamptz, text) TO service_role;
