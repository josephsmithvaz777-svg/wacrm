-- ============================================================
-- 071_list_old_chat_media.sql
--
-- Admin media cleanup lists chat-media objects older than a cutoff
-- for one account. Deletes go through the Storage API, not SQL.
-- Service-role only — the API route checks admin role first.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_old_chat_media(
  p_account_id uuid,
  p_before timestamptz
)
RETURNS TABLE(object_name text, bytes bigint, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = storage, public
AS $$
  SELECT
    o.name,
    COALESCE((o.metadata ->> 'size')::bigint, 0),
    o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'chat-media'
    AND o.name LIKE ('account-' || p_account_id::text || '/%')
    AND o.created_at < p_before
  ORDER BY o.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.list_old_chat_media(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_old_chat_media(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.list_old_chat_media(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_old_chat_media(uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public.list_old_chat_media(uuid, timestamptz) IS
  'List chat-media objects for one account older than p_before. Used by admin cleanup; deletes use the Storage API.';
