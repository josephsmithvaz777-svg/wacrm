'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import {
  kindFromMime,
  MAX_AI_MEDIA_ASSETS,
  type AiMediaKind,
} from '@/lib/ai/media-assets';

const BUCKET = 'chat-media';

const ACCEPT =
  'image/png,image/jpeg,image/webp,video/mp4,video/3gpp,audio/ogg,audio/mpeg,audio/aac,audio/mp4,audio/amr,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain';

interface AssetRow {
  id: string;
  title: string;
  description: string | null;
  kind: AiMediaKind;
  media_url: string;
  filename: string | null;
}

const KIND_ICON = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
} as const;

export function AiMediaCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('Settings.aiMedia');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const loadedAccountIdRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/media');
      const data = await res.json();
      if (res.ok) setAssets(data.assets ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchAssets();
  }, [accountId, fetchAssets]);

  const resetCreate = () => {
    setCreating(false);
    setTitle('');
    setDescription('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const saveNew = async () => {
    if (!title.trim() || !file) {
      toast.error(t('titleFileRequired'));
      return;
    }
    const kind = kindFromMime(file.type);
    if (!kind) {
      toast.error(t('unsupportedType'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) {
      toast.error(t('fileTooLarge'));
      return;
    }
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      const { publicUrl, path } = await uploadAccountMedia(BUCKET, file);
      uploadedPath = path;
      const res = await fetch('/api/ai/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          kind,
          media_url: publicUrl,
          storage_path: path,
          filename: file.name,
          mime_type: file.type,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        await deleteAccountMedia(BUCKET, path).catch(() => {});
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('saveSuccess'));
      resetCreate();
      await fetchAssets();
    } catch (err) {
      if (uploadedPath) {
        await deleteAccountMedia(BUCKET, uploadedPath).catch(() => {});
      }
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) {
      toast.error(t('titleFileRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/media/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('updateSuccess'));
      setEditingId(null);
      await fetchAssets();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/media/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setAssets((rows) => rows.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const atCap = assets.length >= MAX_AI_MEDIA_ASSETS;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {assets.length === 0 && !creating && (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            )}

            {assets.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {assets.map((asset) => {
                  const Icon = KIND_ICON[asset.kind];
                  const editing = editingId === asset.id;
                  return (
                    <li key={asset.id} className="px-3 py-2">
                      {editing ? (
                        <div className="space-y-2">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            disabled={saving}
                          />
                          <Textarea
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            rows={2}
                            disabled={saving}
                            placeholder={t('whenPlaceholder')}
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(null)}
                              disabled={saving}
                            >
                              {t('cancel')}
                            </Button>
                            <Button size="sm" onClick={() => void saveEdit()} disabled={saving}>
                              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              {t('save')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-sm text-foreground">
                              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {asset.title}
                            </p>
                            {asset.description && (
                              <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">
                                {asset.description}
                              </p>
                            )}
                          </div>
                          {canEdit && (
                            <span className="flex shrink-0 gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => {
                                  setEditingId(asset.id);
                                  setEditTitle(asset.title);
                                  setEditDescription(asset.description ?? '');
                                  setCreating(false);
                                }}
                                title={t('edit')}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                onClick={() => void remove(asset.id)}
                                title={t('remove')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {creating ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-media-title">{t('fileTitle')}</Label>
                  <Input
                    id="ai-media-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('fileTitlePlaceholder')}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-media-when">{t('whenLabel')}</Label>
                  <Textarea
                    id="ai-media-when"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('whenPlaceholder')}
                    rows={3}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-media-file">{t('file')}</Label>
                  <Input
                    id="ai-media-file"
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    disabled={saving}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">{t('fileHint')}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={resetCreate} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={() => void saveNew()} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('save')}
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCreating(true);
                    setEditingId(null);
                  }}
                  disabled={atCap}
                >
                  <Plus className="mr-2 h-4 w-4" /> {t('addFile')}
                </Button>
              )
            )}
            {atCap && canEdit && (
              <p className="text-xs text-muted-foreground">
                {t('capReached', { max: MAX_AI_MEDIA_ASSETS })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
