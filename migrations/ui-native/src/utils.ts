/** Derive 1–2 uppercase initials from a display name for avatars (native parity with @orbit/ui-web). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return `${first[0]!}${last[0]!}`.toUpperCase();
}
