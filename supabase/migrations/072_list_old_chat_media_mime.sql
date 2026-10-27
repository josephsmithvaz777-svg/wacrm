-- ============================================================
-- 072_list_old_chat_media_mime.sql
-- Return mimetype so admin cleanup can filter videos / images.
-- ============================================================

DROP FUNCTION IF EXISTS public.list_old_chat_media(uuid, timestamptz);

CREATE FUNCTION public.list_old_chat_media(
  p_account_id uuid,
  p_before timestamptz
)
RETURNS TABLE(
  object_name text,
  bytes bigint,
  created_at timestamptz,
  mime text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = storage, public
AS $$
  SELECT
    o.name,
    COALESCE((o.metadata ->> 'size')::bigint, 0),
    o.created_at,
    COALESCE(o.metadata ->> 'mimetype', '')
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
