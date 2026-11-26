'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';

type FunnelRole = 'unspecified' | 'positive' | 'negative';

interface CapiConfig {
  enabled: boolean;
  dataset_id: string;
  lead_event_source: string;
  test_event_code: string;
  has_token: boolean;
  last_error: string | null;
  last_sent_at: string | null;
}

interface StageRow {
  id: string;
  name: string;
  pipeline_name: string;
  position: number;
  meta_funnel_role: FunnelRole;
}

interface EventRow {
  id: string;
  event_name: string;
  status: string;
  event_time: string;
  last_error: string | null;
  meta_lead_id: string;
}

const STATUS_KEY: Record<string, string> = {
  pending: 'metaStatusPending',
  sending: 'metaStatusSending',
  sent: 'metaStatusSent',
  failed: 'metaStatusFailed',
  skipped: 'metaStatusSkipped',
};

export function MetaCapiPanel() {
  const t = useTranslations('Settings.forms');
  const { canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [config, setConfig] = useState<CapiConfig | null>(null);
  const [token, setToken] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [savingStage, setSavingStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/meta/capi', { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadError(true);
      toast.error(json.error || t('metaLoadFailed'));
      return;
    }
    setLoadError(false);
    setConfig(json.config);
    setStages(json.stages ?? []);
    setEvents(json.events ?? []);
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

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    const res = await fetch('/api/meta/capi', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: config.enabled,
        dataset_id: config.dataset_id,
        access_token: token,
        lead_event_source: config.lead_event_source,
        test_event_code: config.test_event_code,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(json.error || t('metaSaveFailed'));
      return;
    }
    setConfig(json.config);
    setToken('');
    toast.success(t('metaSaved'));
  }

  async function handleRole(stageId: string, role: FunnelRole) {
    setStages((prev) =>
      prev.map((stage) =>
        stage.id === stageId ? { ...stage, meta_funnel_role: role } : stage,
      ),
    );
    setSavingStage(stageId);
    const res = await fetch('/api/meta/capi/stages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: stageId, role }),
    });
    const json = await res.json().catch(() => ({}));
    setSavingStage(null);
    if (!res.ok) {
      toast.error(json.error || t('metaSaveFailed'));
      await load();
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    const res = await fetch('/api/meta/capi/backfill', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    setBackfilling(false);
    if (!res.ok) {
      toast.error(json.error || t('metaSaveFailed'));
      return;
    }
    toast.success(
      t('metaBackfillOk', { linked: json.linked ?? 0, enqueued: json.enqueued ?? 0 }),
    );
    await load();
  }

  async function handleDownload(role: 'positive' | 'negative') {
    setDownloading(role);
    const res = await fetch(`/api/meta/capi/audience?role=${role}`);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setDownloading(null);
      toast.error(json.error || t('metaDownloadFailed'));
      return;
    }
    if (type.includes('application/json')) {
      setDownloading(null);
      toast.message(t('metaDownloadEmpty'));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = role === 'positive' ? 'leads-calidad.csv' : 'leads-no-calificados.csv';
    link.click();
    URL.revokeObjectURL(url);
    setDownloading(null);
  }

  return (
    <section className="mt-10 border-t border-border pt-8">
      <SettingsPanelHead title={t('metaTitle')} description={t('metaDescription')} />

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('metaLoading')}</p>
      ) : loadError || !config ? (
        <p className="text-sm text-muted-foreground">{t('metaLoadFailed')}</p>
      ) : (
        <>
          <RequireRole
            min="admin"
            fallback={
              canEditSettings ? null : (
                <p className="text-sm text-muted-foreground">{t('metaAdminOnly')}</p>
              )
            }
          >
            <Card>
              <CardContent className="space-y-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border"
                    checked={config.enabled}
                    onChange={(e) =>
                      setConfig({ ...config, enabled: e.target.checked })
                    }
                  />
                  {t('metaEnabled')}
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="meta-dataset">{t('metaDataset')}</Label>
                    <Input
                      id="meta-dataset"
                      inputMode="numeric"
                      spellCheck={false}
                      value={config.dataset_id}
                      onChange={(e) =>
                        setConfig({ ...config, dataset_id: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">{t('metaDatasetHint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="meta-token">{t('metaToken')}</Label>
                    <Input
                      id="meta-token"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder={config.has_token ? '••••••••' : ''}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {config.has_token ? t('metaTokenSaved') : t('metaTokenHint')}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="meta-source">{t('metaSource')}</Label>
                    <Input
                      id="meta-source"
                      value={config.lead_event_source}
                      onChange={(e) =>
                        setConfig({ ...config, lead_event_source: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="meta-test">{t('metaTestCode')}</Label>
                    <Input
                      id="meta-test"
                      spellCheck={false}
                      value={config.test_event_code}
                      onChange={(e) =>
                        setConfig({ ...config, test_event_code: e.target.value })
                      }
                    />
                  </div>
                </div>

                {config.last_error ? (
                  <p className="text-xs text-destructive">
                    {t('metaLastError')}: {config.last_error}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={saving} onClick={() => void handleSave()}>
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {t('metaSave')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={backfilling}
                    onClick={() => void handleBackfill()}
                  >
                    {backfilling ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {t('metaBackfill')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-foreground">{t('metaStagesTitle')}</h3>
              <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">
                {t('metaStagesHint')}
              </p>
              <p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
                {t('metaCurious')}
              </p>
              {stages.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t('metaNoStages')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                  {stages.map((stage) => (
                    <li
                      key={stage.id}
                      className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {stage.name}
                        </p>
                        {stage.pipeline_name ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {stage.pipeline_name}
                          </p>
                        ) : null}
                      </div>
                      <select
                        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                        value={stage.meta_funnel_role}
                        disabled={savingStage === stage.id}
                        onChange={(e) =>
                          void handleRole(stage.id, e.target.value as FunnelRole)
                        }
                      >
                        <option value="unspecified">{t('metaRoleUnset')}</option>
                        <option value="positive">{t('metaRolePositive')}</option>
                        <option value="negative">{t('metaRoleNegative')}</option>
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={downloading !== null}
                onClick={() => void handleDownload('positive')}
              >
                {downloading === 'positive' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {t('metaDownloadBuyers')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={downloading !== null}
                onClick={() => void handleDownload('negative')}
              >
                {downloading === 'negative' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {t('metaDownloadUnqualified')}
              </Button>
            </div>
          </RequireRole>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-foreground">{t('metaEventsTitle')}</h3>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('metaEventsEmpty')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <span className="font-medium text-foreground">{event.event_name}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {t(STATUS_KEY[event.status] ?? 'metaStatusPending')} ·{' '}
                      {new Date(event.event_time).toLocaleString()}
                    </span>
                    {event.last_error ? (
                      <p className="text-xs text-destructive">{event.last_error}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-foreground">{t('metaChecklistTitle')}</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t('metaCheck1')}</li>
              <li>{t('metaCheck2')}</li>
              <li>{t('metaCheck3')}</li>
              <li>{t('metaCheck4')}</li>
              <li>{t('metaCheck5')}</li>
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
