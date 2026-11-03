// Place a freshly created auth user into an existing account.
//
// `handle_new_user` always gives a new signup their own personal
// account as owner. An admin-created teammate should not keep that
// empty account: move the profile onto the caller's account and
// delete the personal one. Deleting it first would cascade-delete
// the profile, so the move happens before the delete.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountRole } from "@/lib/auth/roles";

export async function attachFreshUser(
  admin: SupabaseClient,
  input: {
    userId: string;
    accountId: string;
    role: Exclude<AccountRole, "owner">;
    fullName: string;
    email: string;
  },
): Promise<void> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("account_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const personalAccountId =
    profile && profile.account_id !== input.accountId
      ? (profile.account_id as string)
      : null;

  if (personalAccountId) {
    const { data: owned, error: ownedError } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", personalAccountId)
      .maybeSingle();
    if (ownedError) throw ownedError;
    if (!owned || owned.owner_user_id !== input.userId) {
      throw new Error("user_belongs_elsewhere");
    }
  }

  if (profile) {
    const { error } = await admin
      .from("profiles")
      .update({
        account_id: input.accountId,
        account_role: input.role,
        full_name: input.fullName,
        email: input.email,
      })
      .eq("user_id", input.userId);
    if (error) throw error;
  } else {
    const { error } = await admin.from("profiles").insert({
      user_id: input.userId,
      full_name: input.fullName,
      email: input.email,
      account_id: input.accountId,
      account_role: input.role,
    });
    if (error) throw error;
  }

  if (personalAccountId) {
    const { error } = await admin
      .from("accounts")
      .delete()
      .eq("id", personalAccountId);
    if (error) throw error;
    return;
  }

  if (!profile) {
    const { data: ownedRows, error } = await admin
      .from("accounts")
      .select("id")
      .eq("owner_user_id", input.userId);
    if (error) throw error;
    for (const row of ownedRows ?? []) {
      const { error: delError } = await admin
        .from("accounts")
        .delete()
        .eq("id", row.id);
      if (delError) throw delError;
    }
  }
}

/**
 * Undo a signup whose confirmation email never went out, or an
 * admin create that failed before the user was placed. Only deletes
 * accounts this user owns, then the auth user (profile cascades).
 */
export async function rollbackFreshUser(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: owned, error } = await admin
    .from("accounts")
    .select("id")
    .eq("owner_user_id", userId);
  if (error) {
    console.error("[rollbackFreshUser] list accounts:", error.message);
  }
  for (const row of owned ?? []) {
    const { error: delError } = await admin
      .from("accounts")
      .delete()
      .eq("id", row.id);
    if (delError) {
      console.error("[rollbackFreshUser] delete account:", delError.message);
    }
  }
  const { error: userError } = await admin.auth.admin.deleteUser(userId);
  if (userError) {
    console.error("[rollbackFreshUser] delete user:", userError.message);
  }
}
