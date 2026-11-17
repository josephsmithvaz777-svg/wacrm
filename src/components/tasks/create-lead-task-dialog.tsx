'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { TaskIconPicker } from '@/components/inbox/task-icon-picker';
import { TaskAssigneeSelect } from '@/components/tasks/task-assignee-select';
import { TaskDueFields } from '@/components/tasks/task-due-fields';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { combineLocalDateAndTime } from '@/lib/datetime/zoned';
import { createClient } from '@/lib/supabase/client';
import { notifyTaskAdvisor } from '@/lib/tasks/notify';
import type { AccountMember } from '@/types';

type ContactPick = {
  id: string;
  name: string | null;
  phone: string | null;
  assigned_to: string | null;
};

function contactOrFilter(raw: string): string | null {
  const compact = raw
    .trim()
    .replace(/[%_\\,()"']/g, '')
    .replace(/\s+/g, ' ');
  if (!compact) return null;
  const pattern = `"%${compact}%"`;
  return `name.ilike.${pattern},phone.ilike.${pattern}`;
}

function contactLabel(contact: ContactPick): string {
  const name = contact.name?.trim();
  if (name && contact.phone) return `${name} · ${contact.phone}`;
  return name || contact.phone || contact.id.slice(0, 8);
}

export function CreateLeadTaskDialog({
  open,
  onOpenChange,
  initialDate,
  initialTime,
  defaultAssigneeId,
  canAssign,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: string;
  initialTime: string;
  defaultAssigneeId: string;
  canAssign: boolean;
  members: AccountMember[];
  onCreated: () => Promise<void> | void;
}) {
  const t = useTranslations('Tasks.page');
  const { accountId, user } = useAuth();
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('');
  const [dueDate, setDueDate] = useState(initialDate);
  const [dueTime, setDueTime] = useState(initialTime);
  const [assignedTo, setAssignedTo] = useState(defaultAssigneeId);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [contact, setContact] = useState<ContactPick | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || contact) return;
    let cancelled = false;
    const handle = setTimeout(
      () => {
        void (async () => {
          setSearching(true);
          const supabase = createClient();
          let request = supabase
            .from('contacts')
            .select('id, name, phone, assigned_to')
            .limit(12);
          const filter = contactOrFilter(query);
          request = filter
            ? request.or(filter)
            : request.order('updated_at', { ascending: false });
          const { data } = await request;
          if (cancelled) return;
          setResults((data as ContactPick[]) ?? []);
          setSearching(false);
        })();
      },
      query.trim() ? 200 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, contact]);

  function pickContact(next: ContactPick) {
    setContact(next);
    setQuery('');
    if (
      canAssign &&
      next.assigned_to &&
      members.some((member) => member.user_id === next.assigned_to)
    ) {
      setAssignedTo(next.assigned_to);
    }
  }

  async function save() {
    const trimmed = title.trim();
    if (!accountId || saving) return;
    if (!contact) {
      toast.error(t('contactRequired'));
      return;
    }
    if (!trimmed) return;

    setSaving(true);
    const supabase = createClient();
    let assignee: string | null = assignedTo || null;
    if (
      assignee &&
      members.length > 0 &&
      !members.some((member) => member.user_id === assignee)
    ) {
      assignee = null;
    }
    if (!assignee && !canAssign) assignee = user?.id ?? null;

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await supabase
      .from('lead_tasks')
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        conversation_id: (conversation?.id as string | undefined) ?? null,
        created_by: user?.id ?? null,
        assigned_to: assignee,
        title: trimmed,
        icon: icon || null,
        due_at: combineLocalDateAndTime(dueDate, dueTime),
      })
      .select('id')
      .single();

    if (error || !created?.id) {
      setSaving(false);
      toast.error(t('toastSaveFailed'));
      return;
    }

    const body = await notifyTaskAdvisor(created.id, 'created');
    setSaving(false);
    if (body.ok && (body.whatsapp || body.email)) {
      toast.success(t('toastCreatedNotified'));
    } else if (!body.ok || body.errors?.length) {
      toast.error(body.errors?.[0] || t('toastNotifyFailed'));
    } else {
      toast.success(t('toastCreated'));
    }
    onOpenChange(false);
    await onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,40rem)] w-full overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>{t('contactLabel')}</Label>
          {contact ? (
            <div className="border-border bg-muted flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
              <span className="text-foreground truncate text-sm">
                {contactLabel(contact)}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
                onClick={() => setContact(null)}
              >
                {t('changeContact')}
              </button>
            </div>
          ) : (
            <>
              <Input
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('contactPlaceholder')}
              />
              <ul className="border-border max-h-40 overflow-y-auto rounded-lg border">
                {results.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="text-foreground hover:bg-muted w-full px-2.5 py-1.5 text-left text-sm"
                      onClick={() => pickContact(row)}
                    >
                      {contactLabel(row)}
                    </button>
                  </li>
                ))}
                {!searching && results.length === 0 ? (
                  <li className="text-muted-foreground px-2.5 py-2 text-xs">
                    {t('contactEmpty')}
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <TaskIconPicker
            value={icon}
            onChange={setIcon}
            label={t('pickIcon')}
          />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            placeholder={t('titlePlaceholder')}
          />
        </div>

        <TaskDueFields
          date={dueDate}
          time={dueTime}
          onDate={setDueDate}
          onTime={setDueTime}
          dateLabel={t('dueDate')}
          timeLabel={t('dueTime')}
          className="[&_input]:h-8 [&_input]:text-sm"
        />

        {canAssign ? (
          <TaskAssigneeSelect
            value={assignedTo}
            onChange={setAssignedTo}
            members={members}
            disabled={saving}
            placeholder={t('assignTo')}
            unassignedLabel={t('unassigned')}
            className="h-8 text-sm"
          />
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || !title.trim() || !contact}
            className="hover:bg-primary/90"
          >
            {t('saveTask')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
