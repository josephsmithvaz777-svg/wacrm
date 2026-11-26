import type { AutomationLogStatus } from '@/types'

/** A run with no steps yet and a live queue row is still waiting. */
export function displayLogStatus(
  status: AutomationLogStatus,
  stepCount: number,
  hasPending: boolean,
): AutomationLogStatus {
  if (stepCount === 0 && hasPending) return 'queued'
  return status
}

export function automationLogStatusClass(status: AutomationLogStatus): string {
  switch (status) {
    case 'success':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'partial':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    case 'queued':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
    case 'running':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-300'
    default:
      return 'border-red-500/30 bg-red-500/10 text-red-300'
  }
}
