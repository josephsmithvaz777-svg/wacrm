-- ============================================================
-- 071_staff_reminder_permission.sql
-- Team reminders (staff_reminders) may only be written by
-- owner/admin, or by an agent the admin designates via
-- profiles.can_manage_staff_reminders.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_manage_staff_reminders BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.can_manage_staff_reminders IS
  'When true and account_role = agent, this member may create/edit team reminders. Owner/admin always can.';

-- Clear the flag when demoting away from agent (keeps roster honest).
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET
    account_role = p_new_role,
    can_manage_staff_reminders = CASE
      WHEN p_new_role = 'agent' THEN can_manage_staff_reminders
      ELSE false
    END
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_staff_reminders(
  p_user_id UUID,
  p_enabled BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role <> 'agent' THEN
    RAISE EXCEPTION 'Only agents can be designated for team reminders'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET can_manage_staff_reminders = COALESCE(p_enabled, false)
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_staff_reminders(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_staff_reminders(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_staff_reminders(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_write_staff_reminders(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = p_account_id
      AND (
        p.account_role IN ('owner', 'admin')
        OR (
          p.account_role = 'agent'
          AND p.can_manage_staff_reminders = true
        )
      )
  );
$$;

ALTER FUNCTION public.can_write_staff_reminders(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_write_staff_reminders(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_staff_reminders(UUID) TO authenticated;

DROP POLICY IF EXISTS staff_reminders_insert ON staff_reminders;
CREATE POLICY staff_reminders_insert ON staff_reminders FOR INSERT
  WITH CHECK (can_write_staff_reminders(account_id));

DROP POLICY IF EXISTS staff_reminders_update ON staff_reminders;
CREATE POLICY staff_reminders_update ON staff_reminders FOR UPDATE
  USING (can_write_staff_reminders(account_id));

DROP POLICY IF EXISTS staff_reminders_delete ON staff_reminders;
CREATE POLICY staff_reminders_delete ON staff_reminders FOR DELETE
  USING (can_write_staff_reminders(account_id));

DROP POLICY IF EXISTS staff_reminder_recipients_insert ON staff_reminder_recipients;
CREATE POLICY staff_reminder_recipients_insert ON staff_reminder_recipients FOR INSERT
  WITH CHECK (can_write_staff_reminders(account_id));

DROP POLICY IF EXISTS staff_reminder_recipients_delete ON staff_reminder_recipients;
CREATE POLICY staff_reminder_recipients_delete ON staff_reminder_recipients FOR DELETE
  USING (can_write_staff_reminders(account_id));
