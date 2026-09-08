import { useEffect, useState } from "react";

import {
  assignableMembers,
  fetchAccountMembers,
} from "@/lib/account/members";
import type { AccountMember } from "@/types";

/** Members who can own a task or conversation (owner / agent). */
export function useAssignableMembers(): AccountMember[] {
  const [members, setMembers] = useState<AccountMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountMembers().then((all) => {
      if (!cancelled) setMembers(assignableMembers(all));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return members;
}
