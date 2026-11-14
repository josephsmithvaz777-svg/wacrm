"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface AutomationOption {
  id: string
  name: string
  is_active: boolean
  stop_on_reply?: boolean
}

export interface WarmingFilters {
  search: string
  tagIds: string[]
  assignedTo: string[]
  includeUnassigned: boolean
  createdFrom: string
  createdTo: string
}

export function WarmingEnrollDialog({
  open,
  onOpenChange,
  selectedIds,
  filteredCount,
  filters,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  filteredCount: number
  filters: WarmingFilters
}) {
  const t = useTranslations("Contacts.page")
  const [automations, setAutomations] = useState<AutomationOption[]>([])
  const [automationId, setAutomationId] = useState("")
  const [scope, setScope] = useState<"selected" | "filters">("selected")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setScope("selected")
    let cancelled = false
    setLoading(true)
    void fetch("/api/automations")
      .then(async (res) => {
        if (!res.ok) throw new Error("load")
        return res.json() as Promise<{ automations?: AutomationOption[] }>
      })
      .then((body) => {
        if (cancelled) return
        const rows = (body.automations ?? []).filter((row) => row.is_active)
        setAutomations(rows)
        const preferred =
          rows.find((row) => row.stop_on_reply) ??
          rows.find((row) => row.name.toLowerCase().includes("calentamiento")) ??
          rows[0]
        setAutomationId(preferred?.id ?? "")
      })
      .catch(() => {
        if (!cancelled) toast.error(t("warmingLoadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, t])

  async function submit() {
    if (!automationId || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/automations/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          automation_id: automationId,
          scope,
          contact_ids: selectedIds,
          filters: {
            search: filters.search,
            tag_ids: filters.tagIds,
            assigned_to: filters.assignedTo,
            include_unassigned: filters.includeUnassigned,
            created_from: filters.createdFrom,
            created_to: filters.createdTo,
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const key =
          body?.error === "inactive"
            ? "warmingInactive"
            : body?.error === "no_contacts"
              ? "warmingEmpty"
              : body?.error === "invalid_date_range"
                ? "toastExportInvalidRange"
                : "warmingFailed"
        toast.error(t(key))
        return
      }
      toast.success(
        t("warmingQueued", {
          count: body.enrolled ?? 0,
          pending: body.alreadyPending ?? 0,
          noPhone: body.noPhone ?? 0,
        }),
      )
      if (body.truncated) toast.message(t("warmingTruncated"))
      onOpenChange(false)
    } catch {
      toast.error(t("warmingFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("warmingTitle")}</DialogTitle>
          <DialogDescription>{t("warmingDesc")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : automations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("warmingNoAutomations")}</p>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">
              {t("warmingAutomation")}
              <select
                value={automationId}
                onChange={(e) => setAutomationId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                {automations.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="warming-scope"
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
                className="mt-1"
              />
              <span>{t("warmingSelected", { count: selectedIds.length })}</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="warming-scope"
                checked={scope === "filters"}
                onChange={() => setScope("filters")}
                className="mt-1"
              />
              <span>{t("warmingFiltered", { count: filteredCount })}</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("warmingCancel")}
          </Button>
          <Button onClick={submit} disabled={saving || loading || !automationId}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("warmingConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
