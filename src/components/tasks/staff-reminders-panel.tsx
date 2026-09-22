"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Plus, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { TaskIconPicker } from "@/components/inbox/task-icon-picker";
import { StaffReminderCalendar } from "@/components/tasks/staff-reminder-calendar";
import { TaskDueFields } from "@/components/tasks/task-due-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { GatedButton } from "@/components/ui/gated-button";
import { useAuth } from "@/hooks/use-auth";
import { fetchAccountMembers, memberLabel } from "@/lib/account/members";
import { isUsableStaffPhone, staffPhoneDigits } from "@/lib/automations/staff-notify";
import { AUTOMATION_GREETING_TZ, formatAlertDateTime } from "@/lib/automations/template-vars";
import { calendarDateInZone, combineLocalDateAndTime } from "@/lib/datetime/zoned";
import { createClient } from "@/lib/supabase/client";
import { type StaffRecurrence, WEEKDAYS, nextYmdForWeekday, weekdayFromYmd, type Weekday } from "@/lib/tasks/staff-reminder";
import { cn } from "@/lib/utils";
import type { StaffExternalContact, StaffReminder, StaffReminderRecipient } from "@/types";

interface TeamMember {
  user_id: string;
  label: string;
  email: string | null;
}

const PRESETS: {
  id: "cleaning" | "birthday";
  icon: string;
  recurrence: StaffRecurrence;
}[] = [
  { id: "cleaning", icon: "🧹", recurrence: "weekly" },
  { id: "birthday", icon: "🎂", recurrence: "yearly" },
];

export function StaffRemindersPanel({
  canEdit,
  view,
  anchor,
  onAnchorChange,
}: {
  canEdit: boolean;
  view: "list" | "day" | "week" | "month";
  anchor: Date;
  onAnchorChange: (next: Date) => void;
}) {
  const t = useTranslations("Tasks.staff");
  const { accountId, user } = useAuth();
  const [items, setItems] = useState<StaffReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("🧹");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(() =>
    calendarDateInZone(new Date(), AUTOMATION_GREETING_TZ),
  );
  const [dueTime, setDueTime] = useState("09:00");
  const [recurrence, setRecurrence] = useState<StaffRecurrence>("once");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [directory, setDirectory] = useState<StaffExternalContact[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [extName, setExtName] = useState("");
  const [extPhone, setExtPhone] = useState("");
  const [savingExternal, setSavingExternal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("staff_reminders")
      .select("*, recipients:staff_reminder_recipients(*)")
      .is("completed_at", null)
      .order("due_at", { ascending: true });
    if (error) {
      toast.error(t("toastSaveFailed"));
      setItems([]);
    } else {
      setItems((data as StaffReminder[]) ?? []);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDirectory = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("staff_external_contacts")
      .select("id, account_id, label, phone, created_by, created_at")
      .eq("account_id", accountId)
      .order("label", { ascending: true });
    setDirectory((data as StaffExternalContact[]) ?? []);
  }, [accountId]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    void fetchAccountMembers().then((all) => {
      setMembers(
        all.map((member) => ({
          user_id: member.user_id,
          label: memberLabel(member),
          email: member.email,
        })),
      );
    });
  }, []);

  function applyPreset(id: "cleaning" | "birthday") {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setIcon(preset.icon);
    setRecurrence(preset.recurrence);
    setTitle(id === "cleaning" ? t("presetCleaningTitle") : t("presetBirthdayTitle"));
  }

  function selectWeekday(day: Weekday) {
    setDueDate(nextYmdForWeekday(day, dueDate));
    if (recurrence !== "weekly") setRecurrence("weekly");
  }

  const selectedWeekday = weekdayFromYmd(dueDate);

  function toggleMember(id: string) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSaved(phone: string) {
    setSelectedPhones((prev) =>
      prev.includes(phone) ? prev.filter((x) => x !== phone) : [...prev, phone],
    );
  }

  async function addExternal() {
    if (!accountId || savingExternal) return;
    const phone = extPhone.trim();
    if (!isUsableStaffPhone(phone)) {
      toast.error(t("toastBadPhone"));
      return;
    }
    const digits = staffPhoneDigits(phone);
    const label = extName.trim() || digits;
    setSavingExternal(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("staff_external_contacts")
      .upsert(
        {
          account_id: accountId,
          label,
          phone: digits,
          created_by: user?.id ?? null,
        },
        { onConflict: "account_id,phone" },
      )
      .select("id, account_id, label, phone, created_by, created_at")
      .single();
    setSavingExternal(false);
    if (error || !data) {
      toast.error(t("toastExternalSaveFailed"));
      return;
    }
    const saved = data as StaffExternalContact;
    setDirectory((prev) => {
      const rest = prev.filter((row) => row.phone !== saved.phone);
      return [...rest, saved].sort((a, b) => a.label.localeCompare(b.label));
    });
    setSelectedPhones((prev) =>
      prev.includes(saved.phone) ? prev : [...prev, saved.phone],
    );
    setExtName("");
    setExtPhone("");
    toast.success(t("toastExternalSaved"));
  }

  async function removeSaved(contact: StaffExternalContact) {
    if (!canEdit) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("staff_external_contacts")
      .delete()
      .eq("id", contact.id);
    if (error) {
      toast.error(t("toastDeleteFailed"));
      return;
    }
    setDirectory((prev) => prev.filter((row) => row.id !== contact.id));
    setSelectedPhones((prev) => prev.filter((phone) => phone !== contact.phone));
  }

  async function handleCreate() {
    if (!canEdit || !accountId || saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error(t("toastNeedTitle"));
      return;
    }
    const dueIso = combineLocalDateAndTime(dueDate, dueTime);
    if (!dueIso) {
      toast.error(t("toastNeedDate"));
      return;
    }
    const chosen = directory.filter((row) => selectedPhones.includes(row.phone));
    if (memberIds.length === 0 && chosen.length === 0) {
      toast.error(t("toastNeedRecipients"));
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("staff_reminders")
      .insert({
        account_id: accountId,
        created_by: user?.id ?? null,
        title: trimmed,
        icon: icon || null,
        notes: notes.trim() || null,
        due_at: dueIso,
        recurrence,
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      toast.error(t("toastSaveFailed"));
      setSaving(false);
      return;
    }

    const rows = [
      ...memberIds.map((user_id) => ({
        reminder_id: data.id,
        account_id: accountId,
        user_id,
        phone: null,
        email: members.find((m) => m.user_id === user_id)?.email ?? null,
        label: members.find((m) => m.user_id === user_id)?.label ?? null,
      })),
      ...chosen.map((e) => ({
        reminder_id: data.id,
        account_id: accountId,
        user_id: null,
        phone: e.phone,
        email: null,
        label: e.label,
      })),
    ];
    const { error: recErr } = await supabase
      .from("staff_reminder_recipients")
      .insert(rows);
    if (recErr) {
      await supabase.from("staff_reminders").delete().eq("id", data.id);
      toast.error(t("toastSaveFailed"));
      setSaving(false);
      return;
    }

    toast.success(t("toastCreated"));
    setTitle("");
    setNotes("");
    setMemberIds([]);
    setSelectedPhones([]);
    setSaving(false);
    await load();
  }

  async function handleDelete(id: string) {
    if (!canEdit) return;
    const supabase = createClient();
    const { error } = await supabase.from("staff_reminders").delete().eq("id", id);
    if (error) {
      toast.error(t("toastDeleteFailed"));
      return;
    }
    await load();
  }

  async function handleComplete(id: string) {
    if (!canEdit) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("staff_reminders")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(t("toastSaveFailed"));
      return;
    }
    await load();
  }

  async function handleRemindNow(id: string) {
    const res = await fetch(`/api/staff-reminders/${id}/remind`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => ({}))) as {
      whatsapp?: number;
      email?: number;
      notified?: number;
      errors?: string[];
    };
    if (!res.ok) {
      toast.error(t("toastRemindFailed"));
      return;
    }
    if ((body.whatsapp ?? 0) > 0 || (body.email ?? 0) > 0 || (body.notified ?? 0) > 0) {
      toast.success(t("toastRemindOk"));
    } else {
      toast.error(body.errors?.[0] || t("toastRemindFailed"));
    }
    await load();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {!canEdit && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("readOnlyHint")}
        </p>
      )}
      {canEdit && (
        <section
          className={cn(
            "rounded-xl border border-border bg-card p-4",
            view !== "list" && "order-2",
          )}
        >
          <h2 className="text-sm font-semibold text-foreground">{t("createTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("createHint")}</p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {preset.icon}{" "}
                {preset.id === "cleaning" ? t("presetCleaning") : t("presetBirthday")}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <TaskIconPicker
              value={icon}
              onChange={setIcon}
              label={t("icon")}
            />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">{t("when")}</p>
              <TaskDueFields
                date={dueDate}
                time={dueTime}
                onDate={setDueDate}
                onTime={setDueTime}
                dateLabel={t("date")}
                timeLabel={t("time")}
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">{t("repeat")}</p>
              <div className="flex flex-wrap gap-1">
                {(["once", "weekly", "yearly"] as StaffRecurrence[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRecurrence(value)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium",
                      recurrence === value
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`recurrence.${value}`)}
                  </button>
                ))}
              </div>
              {recurrence === "weekly" && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    {t("weekdayLabel")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => selectWeekday(day)}
                        className={cn(
                          "rounded-md px-2 py-1 text-[11px] font-medium",
                          selectedWeekday === day
                            ? "bg-primary text-primary-foreground"
                            : "border border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t(`weekday.${day}`)}
                      </button>
                    ))}
                  </div>
                  {selectedWeekday != null && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {t("weeklyHint", {
                        day: t(`weekday.${selectedWeekday}`),
                        time: dueTime || "09:00",
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">{t("whatsappAtTime")}</p>

          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("notesPlaceholder")}
            className="mt-3 bg-muted border-border text-foreground"
          />

          <div className="mt-4">
            <p className="text-xs font-medium text-foreground">{t("members")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("membersHint")}</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {members.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">{t("noMembers")}</p>
              ) : (
                members.map((member) => (
                  <label
                    key={member.user_id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={memberIds.includes(member.user_id)}
                      onCheckedChange={() => toggleMember(member.user_id)}
                    />
                    <span className="text-sm text-foreground">{member.label}</span>
                    {member.user_id === user?.id && (
                      <span className="text-[10px] text-muted-foreground">{t("you")}</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium text-foreground">{t("externalTitle")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("externalHint")}</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {directory.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">{t("externalEmpty")}</p>
              ) : (
                directory.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={selectedPhones.includes(contact.phone)}
                        onCheckedChange={() => toggleSaved(contact.phone)}
                      />
                      <span className="truncate text-sm text-foreground">
                        {contact.label}
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          {contact.phone}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void removeSaved(contact)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={t("removeSaved")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                value={extName}
                onChange={(e) => setExtName(e.target.value)}
                placeholder={t("externalName")}
                className="bg-muted border-border text-foreground"
              />
              <Input
                value={extPhone}
                onChange={(e) => setExtPhone(e.target.value)}
                placeholder={t("externalPhone")}
                className="bg-muted border-border text-foreground"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void addExternal()}
                disabled={savingExternal}
                className="shrink-0 border-border"
              >
                <Plus className="size-4" />
                {t("addPhone")}
              </Button>
            </div>
          </div>

          <GatedButton
            canAct={canEdit}
            gateReason="create team reminders"
            onClick={() => void handleCreate()}
            disabled={saving}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? t("saving") : t("create")}
          </GatedButton>
        </section>
      )}

      <section className={cn("min-h-0 flex-1", view !== "list" && "order-1")}>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : view !== "list" ? (
          <StaffReminderCalendar
            items={items}
            view={view}
            anchor={anchor}
            onAnchorChange={onAnchorChange}
            canEdit={canEdit}
            onDelete={(id) => void handleDelete(id)}
            onComplete={(id) => void handleComplete(id)}
            onRemind={(id) => void handleRemindNow(id)}
          />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">{t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <StaffReminderRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                t={t}
                onDelete={() => void handleDelete(item.id)}
                onComplete={() => void handleComplete(item.id)}
                onRemind={() => void handleRemindNow(item.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StaffReminderRow({
  item,
  canEdit,
  t,
  onDelete,
  onComplete,
  onRemind,
}: {
  item: StaffReminder;
  canEdit: boolean;
  t: ReturnType<typeof useTranslations>;
  onDelete: () => void;
  onComplete: () => void;
  onRemind: () => void;
}) {
  const due = formatAlertDateTime(new Date(item.due_at));
  const people = (item.recipients ?? []).map(recipientLabel).filter(Boolean);
  const weekday = weekdayFromYmd(
    calendarDateInZone(new Date(item.due_at), AUTOMATION_GREETING_TZ),
  );
  const recurrenceLabel =
    item.recurrence === "weekly" && weekday != null
      ? t("weeklyShort", { day: t(`weekday.${weekday}`) })
      : t(`recurrence.${item.recurrence}`);

  return (
    <li className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {item.icon ? `${item.icon} ` : ""}
            {item.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {due} · {recurrenceLabel}
          </p>
          {people.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{people.join(" · ")}</p>
          )}
          {item.notes && (
            <p className="mt-1 text-xs text-foreground/80">{item.notes}</p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onRemind}
              className="border-border text-muted-foreground"
            >
              <Bell className="size-3.5" />
              {t("sendNow")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onComplete}
              className="border-border text-muted-foreground"
            >
              {t("done")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function recipientLabel(row: StaffReminderRecipient): string {
  return (row.label || row.phone || "").trim();
}
