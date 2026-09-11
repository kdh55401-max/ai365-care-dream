export function sameFinalReport(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  return ['change', 'action', 'result', 'escalation', 'caregiverNote'].every(k =>
    typeof (left[k] ?? '') === 'string' && (left[k] ?? '') === (right[k] ?? ''))
}
