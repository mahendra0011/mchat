/** Tiny relative-time helper (e.g. "just now", "3m ago", "2h ago", "5d ago"). */
export function formatRelativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  const deltaMs = nowMs - parsed;
  if (deltaMs < 0) return formatClockTime(iso);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(parsed);
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Format an ISO timestamp as a short clock time (HH:MM). */
export function formatClockTime(iso: string | null | undefined, hour12 = false): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
}
