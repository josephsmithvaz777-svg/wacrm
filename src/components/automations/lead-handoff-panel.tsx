"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_LEAD_HANDOFF,
  type LeadHandoffSettings,
} from "@/lib/automations/lead-handoff";

export function LeadHandoffPanel({ onSaved }: { onSaved?: () => void }) {
  const t = useTranslations("Automations.leadHandoff");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] =
    useState<LeadHandoffSettings>(DEFAULT_LEAD_HANDOFF);
  const [saved, setSaved] = useState<LeadHandoffSettings>(DEFAULT_LEAD_HANDOFF);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automations/lead-handoff", {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("loadError"));
      const next = (body.settings ?? DEFAULT_LEAD_HANDOFF) as LeadHandoffSettings;
      setSettings(next);
      setSaved(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    settings.enabled !== saved.enabled ||
    settings.customerMessage !== saved.customerMessage ||
    settings.askPhoneMessage !== saved.askPhoneMessage ||
    settings.staffMessage !== saved.staffMessage;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/automations/lead-handoff", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("saveError"));
      const next = (body.settings ?? settings) as LeadHandoffSettings;
      setSettings(next);
      setSaved(next);
      toast.success(t("saved"));
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="flex h-40 items-center justify-center rounded-xl border border-border bg-card">
        <Loader2 className="size-6 animate-spin text-primary" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="shrink-0"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? t("saving") : t("save")}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t("enabled")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("enabledDesc")}
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(v) =>
              setSettings((prev) => ({ ...prev, enabled: !!v }))
            }
            aria-label={t("enabled")}
          />
        </div>

        <MessageField
          id="lead-customer-message"
          label={t("customerMessage")}
          hint={t("customerMessageHint")}
          value={settings.customerMessage}
          onChange={(customerMessage) =>
            setSettings((prev) => ({ ...prev, customerMessage }))
          }
        />

        <MessageField
          id="lead-ask-phone-message"
          label={t("askPhoneMessage")}
          hint={t("askPhoneMessageHint")}
          value={settings.askPhoneMessage}
          onChange={(askPhoneMessage) =>
            setSettings((prev) => ({ ...prev, askPhoneMessage }))
          }
        />

        <MessageField
          id="lead-staff-message"
          label={t("staffMessage")}
          hint={t("staffMessageHint")}
          value={settings.staffMessage}
          onChange={(staffMessage) =>
            setSettings((prev) => ({ ...prev, staffMessage }))
          }
        />
      </div>
    </section>
  );
}

function MessageField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="min-h-24 bg-background font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
