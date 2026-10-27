'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { HardDrive, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  CLEANUP_BEFORE_MONTH,
  CLEANUP_DAY_OPTIONS,
  CLEANUP_KIND_OPTIONS,
  type CleanupAgeScope,
  type CleanupMediaKind,
  type MediaCleanupPreview,
} from '@/lib/storage/cleanup-chat-media';

function formatMb(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaCleanupPanel() {
  const t = useTranslations('Settings.storage');
  const [age, setAge] = useState<CleanupAgeScope>(7);
  const [kind, setKind] = useState<CleanupMediaKind>('video');
  const [preview, setPreview] = useState<MediaCleanupPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handlePreview() {
    setLoading(true);
    setPreview(null);
    const params = new URLSearchParams({
      age: String(age),
      kind,
    });
    const res = await fetch(`/api/admin/media-cleanup?${params}`, {
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast.error(json.error || t('previewFailed'));
      return;
    }
    setPreview(json.preview);
  }

  async function handleDelete() {
    if (!preview || preview.files === 0) return;
    const ok = window.confirm(
      t('confirm', { files: preview.files, size: formatMb(preview.bytes) }),
    );
    if (!ok) return;

    setDeleting(true);
    const res = await fetch('/api/admin/media-cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age, kind }),
    });
    const json = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      toast.error(json.error || t('deleteFailed'));
      return;
    }
    const deleted = json.result?.deleted ?? 0;
    toast.success(t('deleted', { count: deleted }));
    setPreview(null);
    void handlePreview();
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Alert className="mb-5">
        <HardDrive />
        <AlertDescription>{t('keepText')}</AlertDescription>
      </Alert>

      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cleanup-age">{t('olderThan')}</Label>
              <select
                id="cleanup-age"
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={String(age)}
                onChange={(e) => {
                  const value = e.target.value;
                  setAge(
                    value === CLEANUP_BEFORE_MONTH
                      ? CLEANUP_BEFORE_MONTH
                      : (Number(value) as CleanupAgeScope),
                  );
                  setPreview(null);
                }}
              >
                {CLEANUP_DAY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t('daysOption', { days: option })}
                  </option>
                ))}
                <option value={CLEANUP_BEFORE_MONTH}>{t('beforeMonth')}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cleanup-kind">{t('kindLabel')}</Label>
              <select
                id="cleanup-kind"
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as CleanupMediaKind);
                  setPreview(null);
                }}
              >
                {CLEANUP_KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`kind.${option}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t('hint')}</p>

          {preview ? (
            <p className="text-sm text-muted-foreground">
              {preview.files === 0
                ? t('nothing')
                : t('previewSummary', {
                    files: preview.files,
                    size: formatMb(preview.bytes),
                  })}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void handlePreview()}
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('preview')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || !preview || preview.files === 0}
              onClick={() => void handleDelete()}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {t('delete')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
