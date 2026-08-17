"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { useAuth } from "@/hooks/use-auth";
import { DealForm } from "@/components/pipelines/deal-form";
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  Pipeline,
  PipelineStage,
} from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Pencil,
  X,
  Loader2,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Called after name/details/tags are saved so the Inbox list + thread header refresh. */
  onContactUpdated?: (contact: Contact) => void;
}

export function ContactSidebar({
  contact,
  onContactUpdated,
}: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [updatingStageId, setUpdatingStageId] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [dealFormPipelineId, setDealFormPipelineId] = useState("");
  const [dealFormStageId, setDealFormStageId] = useState("");

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    const [dealsRes, notesRes, tagsRes, allTagsRes, pipelinesRes, stagesRes] =
      await Promise.all([
        supabase
          .from("deals")
          .select("*, stage:pipeline_stages(*)")
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("contact_notes")
          .select("*")
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("contact_tags")
          .select("id, tag_id, tags(*)")
          .eq("contact_id", contact.id),
        supabase.from("tags").select("*").order("name"),
        supabase.from("pipelines").select("*").order("created_at"),
        supabase
          .from("pipeline_stages")
          .select("*")
          .order("position", { ascending: true }),
      ]);

    if (dealsRes.data) setDeals(dealsRes.data as Deal[]);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    if (allTagsRes.data) setAllTags(allTagsRes.data as Tag[]);
    if (pipelinesRes.data) setPipelines(pipelinesRes.data as Pipeline[]);
    if (stagesRes.data) {
      const byPipeline: Record<string, PipelineStage[]> = {};
      for (const stage of stagesRes.data as PipelineStage[]) {
        (byPipeline[stage.pipeline_id] ??= []).push(stage);
      }
      setStagesByPipeline(byPipeline);
    }
  }, [contact]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  useEffect(() => {
    setEditingName(false);
    setNameDraft(contact?.name ?? "");
    setTagPickerOpen(false);
  }, [contact?.id, contact?.name]);

  const assignedTagIds = useMemo(
    () => new Set(tags.map((t) => t.id)),
    [tags],
  );

  const availableTags = useMemo(
    () => allTags.filter((t) => !assignedTagIds.has(t.id)),
    [allTags, assignedTagIds],
  );

  const notifyTagsUpdated = useCallback(
    (nextTags: (Tag & { contact_tag_id: string })[]) => {
      if (!contact) return;
      onContactUpdated?.({
        ...contact,
        tags: nextTags.map(({ contact_tag_id: _id, ...tag }) => tag),
      });
    },
    [contact, onContactUpdated],
  );

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleSaveName = useCallback(async () => {
    if (!contact) return;
    const nextName = nameDraft.trim() || contact.phone;
    if (nextName === (contact.name || contact.phone)) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contacts")
      .update({
        name: nextName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id)
      .select()
      .single();

    setSavingName(false);
    if (error || !data) {
      toast.error(tSidebar("toastNameUpdateFailed"));
      return;
    }
    toast.success(tSidebar("toastNameUpdated"));
    setEditingName(false);
    onContactUpdated?.(data as Contact);
  }, [contact, nameDraft, onContactUpdated, tSidebar]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleRemoveTag = useCallback(
    async (tag: Tag & { contact_tag_id: string }) => {
      if (!contact) return;
      setSavingTags(true);
      try {
        await deleteContactTag(contact.id, tag.id);
        const next = tags.filter((t) => t.id !== tag.id);
        setTags(next);
        notifyTagsUpdated(next);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : tSidebar("toastTagUpdateFailed"),
        );
      }
      setSavingTags(false);
    },
    [contact, tags, notifyTagsUpdated, tSidebar],
  );

  const handleAddTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      setSavingTags(true);
      try {
        await addContactTag(contact.id, tag.id);
        const { data } = await createClient()
          .from("contact_tags")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("tag_id", tag.id)
          .maybeSingle();
        const next = [
          ...tags,
          { ...tag, contact_tag_id: (data?.id as string) ?? tag.id },
        ];
        setTags(next);
        notifyTagsUpdated(next);
        setTagPickerOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : tSidebar("toastTagUpdateFailed"),
        );
      }
      setSavingTags(false);
    },
    [contact, tags, notifyTagsUpdated, tSidebar],
  );

  const handleStageChange = useCallback(
    async (deal: Deal, newStageId: string) => {
      if (deal.stage_id === newStageId) return;
      setUpdatingStageId(deal.id);
      const supabase = createClient();
      const stages = stagesByPipeline[deal.pipeline_id] ?? [];
      const nextStage = stages.find((s) => s.id === newStageId);
      const { error } = await supabase
        .from("deals")
        .update({
          stage_id: newStageId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deal.id);
      setUpdatingStageId(null);
      if (error) {
        toast.error(tSidebar("toastStageUpdateFailed"));
        return;
      }
      setDeals((prev) =>
        prev.map((d) =>
          d.id === deal.id
            ? { ...d, stage_id: newStageId, stage: nextStage ?? d.stage }
            : d,
        ),
      );
      toast.success(tSidebar("toastStageUpdated"));
    },
    [stagesByPipeline, tSidebar],
  );

  const openCreateDeal = useCallback(() => {
    const pipelineId = deals[0]?.pipeline_id || pipelines[0]?.id || "";
    if (!pipelineId) {
      toast.error(tSidebar("toastNoPipeline"));
      return;
    }
    const stages = stagesByPipeline[pipelineId] ?? [];
    setEditingDeal(null);
    setDealFormPipelineId(pipelineId);
    setDealFormStageId(stages[0]?.id ?? "");
    setDealFormOpen(true);
  }, [deals, pipelines, stagesByPipeline, tSidebar]);

  const openEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDealFormPipelineId(deal.pipeline_id);
    setDealFormStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">
          {tThread("selectConversation")}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();
  const dealFormStages = stagesByPipeline[dealFormPipelineId] ?? [];

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>

            {editingName ? (
              <div className="mt-3 flex w-full items-center gap-1">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder={tSidebar("namePlaceholder")}
                  className="h-8 text-sm"
                  autoFocus
                  disabled={savingName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSaveName();
                    }
                    if (e.key === "Escape") {
                      setEditingName(false);
                      setNameDraft(contact.name ?? "");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 p-0"
                  onClick={() => void handleSaveName()}
                  disabled={savingName}
                  aria-label={tSidebar("saveName")}
                >
                  {savingName ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 p-0"
                  onClick={() => {
                    setEditingName(false);
                    setNameDraft(contact.name ?? "");
                  }}
                  disabled={savingName}
                  aria-label={tSidebar("cancelEditName")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex max-w-full items-center justify-center gap-1">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {displayName}
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setNameDraft(contact.name ?? "");
                    setEditingName(true);
                  }}
                  aria-label={tSidebar("editName")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                <PopoverTrigger
                  disabled={savingTags}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  aria-label={tSidebar("addTag")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-2">
                  {availableTags.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      {tSidebar("noTagsAvailable")}
                    </p>
                  ) : (
                    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                      {availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          disabled={savingTags}
                          onClick={() => void handleAddTag(tag)}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="truncate text-foreground">
                            {tag.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noTags")}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 pr-1 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      disabled={savingTags}
                      onClick={() => void handleRemoveTag(tag)}
                      className="rounded-full p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
                      aria-label={tSidebar("removeTag")}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Pipeline / Deals */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                {tSidebar("pipeline")}
              </div>
              <button
                type="button"
                onClick={openCreateDeal}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={tSidebar("addDeal")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <div className="px-1">
                  <p className="text-xs text-muted-foreground">
                    {tSidebar("noDeals")}
                  </p>
                  <button
                    type="button"
                    onClick={openCreateDeal}
                    className="mt-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    {tSidebar("createDeal")}
                  </button>
                </div>
              ) : (
                deals.map((deal) => {
                  const stages = stagesByPipeline[deal.pipeline_id] ?? [];
                  const isUpdating = updatingStageId === deal.id;
                  return (
                    <div
                      key={deal.id}
                      className="rounded-lg bg-muted px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {deal.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {deal.currency ?? "$"}
                            {Number(deal.value ?? 0).toLocaleString()}
                            {deal.status && deal.status !== "open" ? (
                              <span className="ml-1 uppercase opacity-70">
                                · {deal.status}
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditDeal(deal)}
                          aria-label={tSidebar("editDeal")}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="mt-2 flex items-center gap-1.5">
                        <DollarSign className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <select
                          value={deal.stage_id}
                          disabled={isUpdating || stages.length === 0}
                          onChange={(e) =>
                            void handleStageChange(deal, e.target.value)
                          }
                          className="h-7 w-full truncate rounded-md border border-border bg-card px-1.5 text-[11px] text-foreground outline-none focus:border-primary disabled:opacity-50"
                          aria-label={tSidebar("stage")}
                        >
                          {stages.length === 0 && deal.stage ? (
                            <option value={deal.stage_id}>
                              {deal.stage.name}
                            </option>
                          ) : (
                            stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))
                          )}
                        </select>
                        {isUpdating && (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {dealFormPipelineId ? (
        <DealForm
          open={dealFormOpen}
          onOpenChange={setDealFormOpen}
          deal={editingDeal}
          pipelineId={dealFormPipelineId}
          stages={dealFormStages}
          defaultStageId={dealFormStageId}
          defaultContactId={contact.id}
          onSaved={() => {
            void fetchContactData();
          }}
        />
      ) : null}
    </div>
  );
}
