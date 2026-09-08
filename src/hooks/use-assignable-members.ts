import { useEffect, useState } from "react";

import {
  fetchAccountMembers,
  taskAssignableMembers,
} from "@/lib/account/members";
import type { AccountMember } from "@/types";

/** Members who can own a task (owner / admin / agent). Conversation leads use `assignableMembers`. */
export function useAssignableMembers(): AccountMember[] {
  const [members, setMembers] = useState<AccountMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountMembers().then((all) => {
      if (!cancelled) setMembers(taskAssignableMembers(all));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return members;
}
