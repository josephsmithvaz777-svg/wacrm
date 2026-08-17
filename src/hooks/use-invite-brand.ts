"use client";

import { useEffect, useState } from "react";

export interface SiteBrand {
  name: string | null;
  logoUrl: string | null;
  loading: boolean;
}

/**
 * Public login branding from Settings → Branding (admin opt-in).
 * Prefer invite peek brand when an invite token is present.
 */
export function useSiteBrand(): SiteBrand {
  const [name, setName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/branding", { cache: "no-store" });
        const body = (await res.json()) as {
          ok?: boolean;
          name?: string;
          logo_url?: string | null;
        };
        if (cancelled) return;
        if (body.ok) {
          setName(typeof body.name === "string" ? body.name : null);
          setLogoUrl(
            typeof body.logo_url === "string" && body.logo_url
              ? body.logo_url
              : null,
          );
        } else {
          setName(null);
          setLogoUrl(null);
        }
      } catch {
        if (!cancelled) {
          setName(null);
          setLogoUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { name, logoUrl, loading };
}

export interface InvitePeekBrand {
  accountName: string | null;
  logoUrl: string | null;
  loading: boolean;
}

/**
 * Load public invite peek branding for /login?invite= and /signup?invite=.
 */
export function useInviteBrand(inviteToken: string | null): InvitePeekBrand {
  const [accountName, setAccountName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(inviteToken));

  useEffect(() => {
    if (!inviteToken) {
      setAccountName(null);
      setLogoUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/invitations/${encodeURIComponent(inviteToken)}/peek`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          ok?: boolean;
          account_name?: string;
          logo_url?: string | null;
        };
        if (cancelled) return;
        if (body.ok) {
          setAccountName(body.account_name ?? null);
          setLogoUrl(
            typeof body.logo_url === "string" && body.logo_url
              ? body.logo_url
              : null,
          );
        } else {
          setAccountName(null);
          setLogoUrl(null);
        }
      } catch {
        if (!cancelled) {
          setAccountName(null);
          setLogoUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  return { accountName, logoUrl, loading };
}
