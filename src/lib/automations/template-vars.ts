// ============================================================
// Placeholders for automation send_message / notify text.
// Time-of-day greeting is America/Lima (Peru) so Coolify UTC
// does not turn a 9am lead into "Buenas noches".
// ============================================================

export const AUTOMATION_GREETING_TZ = 'America/Lima';

export function greetingForInstant(
  now: Date = new Date(),
  timeZone: string = AUTOMATION_GREETING_TZ,
): string {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  }).format(now);
  const hour = Number.parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return 'Buenos días';
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export function fillAutomationPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? '';
  });
}
