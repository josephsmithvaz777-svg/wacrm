'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';
import { StatusDot } from './settings-chip';

interface SheetSource {
  id: string;
  name: string;
  spreadsheet_url: string;
  enabled: boolean;
  assign_round_robin: boolean;
  default_country_code: string;
  tag_name: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  last_imported_count: number;
}

interface Preview {
  headers: string[];
  rowCount: number;
  sampleName: string | null;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function SheetLeadsPanel() {
  const t = useTranslations('Settings.forms');
  const { canEditSettings } = useAuth();

  const [sources, setSources] = useState<SheetSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [tagName, setTagName] = useState('');
  const [country, setCountry] = useState('51');
  const [assign, setAssign] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/leads/sheet-sources', { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || t('loadFailed'));
      return;
    }
    setSources(json.sources ?? []);
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function handlePreview() {
    setPreviewing(true);
    setPreview(null);
    const res = await fetch('/api/leads/sheet-sources/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const json = await res.json().catch(() => ({}));
    setPreviewing(false);
    if (!res.ok) {
      toast.error(json.error || t('previewFailed'));
      return;
    }
    setPreview(json);
    toast.success(t('previewOk', { count: json.rowCount }));
  }

  async function handleCreate() {
    setSaving(true);
    const res = await fetch('/api/leads/sheet-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        name,
        tag_name: tagName,
        default_country_code: country,
        assign_round_robin: assign,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(json.error || t('saveFailed'));
      return;
    }
    setUrl('');
    setName('');
    setTagName('');
    setPreview(null);
    toast.success(t('saved'));
    await load();
    if (json.source?.id) {
      void handleSync(json.source.id);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    const res = await fetch(`/api/leads/sheet-sources/${id}/sync`, {
      method: 'POST',
    });
    const json = await res.json().catch(() => ({}));
    setSyncingId(null);
    if (!res.ok) {
      toast.error(json.error || t('syncFailed'));
      await load();
      return;
    }
    const imported = json.result?.imported ?? 0;
    const assigned = json.result?.assigned ?? 0;
    toast.success(t('syncOk', { imported, assigned }));
    await load();
  }

  async function handleToggle(source: SheetSource, enabled: boolean) {
    const res = await fetch(`/api/leads/sheet-sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      toast.error(t('saveFailed'));
      return;
    }
    await load();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/leads/sheet-sources/${id}`, {
      method: 'DELETE',
    });
    setDeletingId(null);
    if (!res.ok) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    await load();
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Alert className="mb-5">
        <FileSpreadsheet />
        <AlertDescription>{t('shareHint')}</AlertDescription>
      </Alert>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('loading')}
        </div>
      ) : sources.length === 0 ? (
        <p className="mb-5 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="mb-5 space-y-3">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {source.name}
                    </p>
                    <a
                      href={source.spreadsheet_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {t('openSheet')}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {source.enabled ? (
                      <>
                        <StatusDot tone="ok" /> {t('enabled')}
                      </>
                    ) : (
                      <>
                        <StatusDot tone="muted" /> {t('disabled')}
                      </>
                    )}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  {source.last_synced_at
                    ? t('lastSync', {
                        when: fmtWhen(source.last_synced_at),
                        count: source.last_imported_count,
                      })
                    : t('neverSynced')}
                </p>
                {source.last_error ? (
                  <p className="text-xs text-destructive">{source.last_error}</p>
                ) : null}

                <RequireRole min="admin">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={syncingId === source.id}
                      onClick={() => void handleSync(source.id)}
                    >
                      {syncingId === source.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      {t('syncNow')}
                    </Button>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border"
                        checked={source.enabled}
                        onChange={(e) =>
                          void handleToggle(source, e.target.checked)
                        }
                      />
                      {t('autoSync')}
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={deletingId === source.id}
                      onClick={() => void handleDelete(source.id)}
                    >
                      {deletingId === source.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      {t('disconnect')}
                    </Button>
                  </div>
                </RequireRole>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RequireRole
        min="admin"
        fallback={
          canEditSettings ? null : (
            <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>
          )
        }
      >
        <Card>
          <CardContent className="space-y-3 py-4">
            <p className="text-sm font-medium text-foreground">{t('addTitle')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="sheet-url">{t('urlLabel')}</Label>
              <Input
                id="sheet-url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreview(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/…"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sheet-name">{t('nameLabel')}</Label>
                <Input
                  id="sheet-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sheet-tag">{t('tagLabel')}</Label>
                <Input
                  id="sheet-tag"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  placeholder={t('tagPlaceholder')}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sheet-cc">{t('countryLabel')}</Label>
                <Input
                  id="sheet-cc"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="51"
                />
                <p className="text-xs text-muted-foreground">{t('countryHint')}</p>
              </div>
              <label className="flex items-center gap-2 self-end text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border"
                  checked={assign}
                  onChange={(e) => setAssign(e.target.checked)}
                />
                {t('assignLabel')}
              </label>
            </div>

            {preview ? (
              <p className="text-xs text-muted-foreground">
                {t('previewSummary', {
                  count: preview.rowCount,
                  sample: preview.sampleName || '—',
                })}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!url.trim() || previewing}
                onClick={() => void handlePreview()}
              >
                {previewing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {t('testConnection')}
              </Button>
              <Button
                type="button"
                disabled={!url.trim() || saving}
                onClick={() => void handleCreate()}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {t('connect')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </RequireRole>
    </section>
  );
}
