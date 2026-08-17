'use client';

import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useSoundPrefs } from '@/hooks/use-sound-prefs';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { NotificationsSettingsPanel } from '@/components/settings/notifications-settings-panel';
import { ActivityLogsPanel } from '@/components/settings/activity-logs-panel';
import { BrandingSettings } from '@/components/settings/branding-settings';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  DEFAULT_SECTION,
  SECTION_META,
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, canManageMembers } = useAuth();
  const { mode } = useTheme();
  const { soundNotifications, soundMessages } = useSoundPrefs();
  const t = useTranslations('Settings');
  const tNotif = useTranslations('Settings.notifications');

  let section = resolveSection(searchParams.get('tab'));
  if (SECTION_META[section]?.adminOnly && !canManageMembers) {
    section = DEFAULT_SECTION;
  }

  const go = (next: SettingsSection) => {
    if (SECTION_META[next]?.adminOnly && !canManageMembers) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const raw = searchParams.get('tab');
    if (!raw) return;
    const resolved = resolveSection(raw);
    if (SECTION_META[resolved]?.adminOnly && !canManageMembers) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', DEFAULT_SECTION);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, canManageMembers, router]);

  const soundsHint =
    soundNotifications || soundMessages
      ? tNotif('hintOn')
      : tNotif('hintOff');

  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
      notifications: soundsHint,
    }),
    [mode, defaultCurrency, soundsHint],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    notifications: <NotificationsSettingsPanel />,
    branding: <BrandingSettings />,
    whatsapp: <WhatsAppConfig />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    activity: <ActivityLogsPanel />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageDesc')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
