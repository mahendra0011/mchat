import type { ContactRequestStatus } from '@orbit/schemas';

const RESERVED_HANDLES = new Set([
  'admin',
  'root',
  'system',
  'support',
  'security',
  'help',
  'orbit',
  'official',
  'moderator',
]);

export function sanitizeSearchHandle(raw: string): string {
  let cleaned = raw.trim().toLowerCase();
  if (cleaned.startsWith('@')) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

export function validateHandleFormat(handle: string): { valid: boolean; reason?: string } {
  const normalized = sanitizeSearchHandle(handle);

  if (normalized.length < 3 || normalized.length > 30) {
    return { valid: false, reason: 'Handle must be between 3 and 30 characters.' };
  }

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return {
      valid: false,
      reason: 'Handle may only contain lowercase letters, numbers, and underscores.',
    };
  }

  if (RESERVED_HANDLES.has(normalized)) {
    return { valid: false, reason: 'This handle is reserved by the system.' };
  }

  return { valid: true };
}

export function canTransitionContactRequest(
  current: ContactRequestStatus,
  next: ContactRequestStatus
): boolean {
  if (current === next) return true;

  switch (current) {
    case 'pending':
      return ['accepted', 'ignored', 'blocked'].includes(next);
    case 'ignored':
      return ['accepted', 'blocked'].includes(next);
    case 'accepted':
      return ['blocked'].includes(next);
    case 'blocked':
      // Unblocking returns to ignored/pending
      return ['ignored', 'pending'].includes(next);
    default:
      return false;
  }
}
