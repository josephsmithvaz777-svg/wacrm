-- ============================================================
-- 043_login_branding.sql
-- Let one workspace publish its white-label name + logo on the
-- public login/signup pages (admin-controlled in Settings → Branding).
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS login_branding BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN accounts.login_branding IS
  'When true, this account name + logo_url are shown on /login and /signup.';

-- At most one workspace can brand the shared login screen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_login_brand
  ON accounts ((TRUE))
  WHERE login_branding;

CREATE OR REPLACE FUNCTION public.get_login_branding()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_logo TEXT;
BEGIN
  SELECT a.name, a.logo_url
  INTO v_name, v_logo
  FROM accounts a
  WHERE a.login_branding = TRUE
  LIMIT 1;

  IF v_name IS NULL THEN
    RETURN json_build_object('ok', false);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'name', v_name,
    'logo_url', v_logo
  );
END;
$$;

ALTER FUNCTION public.get_login_branding() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_login_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_login_branding() TO anon, authenticated;

-- When an account turns login_branding on, clear it from others
-- so the unique index never fails mid-update from the client.
CREATE OR REPLACE FUNCTION public.set_account_login_branding(
  p_account_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_enabled THEN
    UPDATE accounts SET login_branding = FALSE WHERE login_branding = TRUE;
    UPDATE accounts SET login_branding = TRUE WHERE id = p_account_id;
  ELSE
    UPDATE accounts SET login_branding = FALSE WHERE id = p_account_id;
  END IF;
END;
$$;

ALTER FUNCTION public.set_account_login_branding(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_account_login_branding(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_account_login_branding(UUID, BOOLEAN) TO authenticated;
