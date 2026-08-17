"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

/**
 * Workspace white-label: company name + logo for the sidebar.
 * Admin+ only (matches accounts_update RLS).
 */
export function BrandingSettings() {
  const t = useTranslations("Settings.branding");
  const supabase = createClient();
  const {
    account,
    accountId,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(account?.name ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(account?.logo_url ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(account?.name ?? "");
    setLogoUrl(account?.logo_url ?? null);
    setPendingFile(null);
    setPreviewUrl(null);
    setRemoveLogo(false);
  }, [account?.id, account?.name, account?.logo_url]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const displayLogo =
    previewUrl ?? (!removeLogo ? logoUrl : null);

  const dirty =
    name.trim() !== (account?.name ?? "") ||
    pendingFile != null ||
    removeLogo;

  function onPickFile(file: File | null) {
    if (!file) return;
    if (!ALLOWED.has(file.type)) {
      toast.error(t("unsupportedImage"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("imageTooLarge"));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveLogo(false);
  }

  async function handleSave() {
    if (!accountId || !canEditSettings) return;
    const nextName = name.trim();
    if (!nextName) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      let nextLogoUrl: string | null = removeLogo ? null : logoUrl;

      if (pendingFile) {
        const ext =
          pendingFile.type === "image/svg+xml"
            ? "svg"
            : pendingFile.type.split("/")[1] || "png";
        const path = `${accountId}/logo-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("account-logos")
          .upload(path, pendingFile, {
            contentType: pendingFile.type,
            upsert: true,
          });
        if (uploadError) {
          throw new Error(t("uploadFailed", { message: uploadError.message }));
        }
        const { data } = supabase.storage
          .from("account-logos")
          .getPublicUrl(path);
        nextLogoUrl = data.publicUrl;
      }

      const { error } = await supabase
        .from("accounts")
        .update({
          name: nextName,
          logo_url: nextLogoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", accountId);

      if (error) throw new Error(error.message);

      await refreshProfile();
      setPendingFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setRemoveLogo(false);
      toast.success(t("saveSuccess"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("saveFailed");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {!canEditSettings && !profileLoading ? (
        <p className="mb-4 text-sm text-muted-foreground">{t("adminOnly")}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Building2 className="size-4 text-primary" />
            {t("title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("companyName")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("companyNamePlaceholder")}
              maxLength={80}
              disabled={!canEditSettings || profileLoading || saving}
            />
            <p className="text-xs text-muted-foreground">{t("companyNameDesc")}</p>
          </div>

          <div className="grid gap-3">
            <Label className="text-muted-foreground">{t("logo")}</Label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                {displayLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displayLogo}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEditSettings || saving}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {displayLogo ? t("changeLogo") : t("uploadLogo")}
                </Button>
                {displayLogo ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canEditSettings || saving}
                    onClick={() => {
                      setPendingFile(null);
                      if (previewUrl) URL.revokeObjectURL(previewUrl);
                      setPreviewUrl(null);
                      setRemoveLogo(true);
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {t("removeLogo")}
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("logoDesc")}</p>
          </div>

          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canEditSettings || !dirty || saving || profileLoading}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
