/**
 * Data-flow map & retention schedule (Spec 08 — Data minimization and retention).
 * Each data category has explicit retention, storage location, and deletion semantics.
 * Used by release gate tests to assert completeness.
 */

export type DataCategory =
  | 'message_body'
  | 'attachment_blob'
  | 'delivery_queue'
  | 'access_log'
  | 'abuse_report'
  | 'analytics_event'
  | 'backup'
  | 'account_deletion_record'
  | 'internal_note'
  | 'draft'
  | 'call_session_metadata'
  | 'presence_telemetry';

export interface RetentionPolicy {
  category: DataCategory;
  retentionDays: number | null; // null = indefinite (e.g. legal hold)
  storageLocation: 'primary_db' | 'object_store' | 'queue' | 'log_store' | 'analytics_store' | 'backup_store';
  encryptedAtRest: boolean;
  containsPlaintextContent: boolean;
  deletedOnAccountDeletion: boolean;
  notes: string;
}

export const RETENTION_SCHEDULE: readonly RetentionPolicy[] = [
  {
    category: 'message_body',
    retentionDays: 365,
    storageLocation: 'primary_db',
    encryptedAtRest: true,
    containsPlaintextContent: true, // server may hold plaintext for non-E2EE; E2EE stores ciphertext
    deletedOnAccountDeletion: true,
    notes: 'E2EE messages stored as ciphertext only; server never holds plaintext for E2EE conversations.',
  },
  {
    category: 'attachment_blob',
    retentionDays: 365,
    storageLocation: 'object_store',
    encryptedAtRest: true,
    containsPlaintextContent: true,
    deletedOnAccountDeletion: true,
    notes: 'Private bucket, short-lived scoped download URLs, MIME validation.',
  },
  {
    category: 'delivery_queue',
    retentionDays: 7,
    storageLocation: 'queue',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    deletedOnAccountDeletion: true,
    notes: 'Outbox entries purged after successful delivery or TTL.',
  },
  {
    category: 'access_log',
    retentionDays: 90,
    storageLocation: 'log_store',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    deletedOnAccountDeletion: false,
    notes: 'Pseudonymous identifiers only; no message content, tokens, or full email/phone.',
  },
  {
    category: 'abuse_report',
    retentionDays: 730,
    storageLocation: 'primary_db',
    encryptedAtRest: true,
    containsPlaintextContent: true,
    deletedOnAccountDeletion: false,
    notes: 'Retained for safety response; controlled access.',
  },
  {
    category: 'analytics_event',
    retentionDays: 180,
    storageLocation: 'analytics_store',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    deletedOnAccountDeletion: true,
    notes: 'Content-free; pseudonymous IDs rotated/limited.',
  },
  {
    category: 'backup',
    retentionDays: 30,
    storageLocation: 'backup_store',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    deletedOnAccountDeletion: true,
    notes: 'Access-controlled; restore tested; expiry documented.',
  },
  {
    category: 'account_deletion_record',
    retentionDays: 30,
    storageLocation: 'primary_db',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    deletedOnAccountDeletion: false,
    notes: 'Minimal proof-of-deletion record; no message content.',
  },
  {
    category: 'internal_note',
    retentionDays: 365,
    storageLocation: 'primary_db',
    encryptedAtRest: true,
    containsPlaintextContent: true,
    deletedOnAccountDeletion: true,
    notes: 'Separate table; never serialized into customer-facing feeds/exports.',
  },
  {
    category: 'draft',
    retentionDays: 90,
    storageLocation: 'primary_db',
    encryptedAtRest: true,
    containsPlaintextContent: true,
    deletedOnAccountDeletion: true,
    notes: 'Workspace-scoped; cleared on send.',
  },
  {
    category: 'call_session_metadata',
    retentionDays: 90,
    storageLocation: 'primary_db',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    notes: 'Duration, participants, status — no media content.',
    deletedOnAccountDeletion: true,
  },
  {
    category: 'presence_telemetry',
    retentionDays: 30,
    storageLocation: 'analytics_store',
    encryptedAtRest: true,
    containsPlaintextContent: false,
    deletedOnAccountDeletion: true,
    notes: 'Online/typing aggregates; no location.',
  },
] as const;

export function getRetentionPolicy(category: DataCategory): RetentionPolicy | undefined {
  return RETENTION_SCHEDULE.find((p) => p.category === category);
}

export function categoriesWithPlaintext(): DataCategory[] {
  return RETENTION_SCHEDULE.filter((p) => p.containsPlaintextContent).map((p) => p.category);
}

export function validateRetentionSchedule(): string[] {
  const errors: string[] = [];
  const seen = new Set<DataCategory>();
  for (const policy of RETENTION_SCHEDULE) {
    if (seen.has(policy.category)) {
      errors.push(`Duplicate policy for ${policy.category}`);
    }
    seen.add(policy.category);
    if (policy.retentionDays !== null && policy.retentionDays <= 0) {
      errors.push(`${policy.category}: retentionDays must be positive or null`);
    }
    if (!policy.encryptedAtRest) {
      errors.push(`${policy.category}: must be encrypted at rest`);
    }
  }
  return errors;
}


export enum C3_CLASSIFIED {
  MESSAGE_PLAINTEXT = 'MESSAGE_PLAINTEXT',
  ATTACHMENT_METADATA = 'ATTACHMENT_METADATA',
  AUTH_MATERIAL = 'AUTH_MATERIAL',
  KEYS = 'KEYS',
  RECOVERY_CODES = 'RECOVERY_CODES',
  PRIVATE_NOTES = 'PRIVATE_NOTES',
  REPORTS = 'REPORTS',
  CREDENTIALS = 'CREDENTIALS',
}

const C3_FIELD_NAMES = new Set<string>([
  'messageplaintext',
  'messagebody',
  'messagecontent',
  'messagetext',
  'attachmentmetadata',
  'attachment',
  'authmaterial',
  'auth',
  'token',
  'password',
  'secret',
  'authorization',
  'cookie',
  'otp',
  'session',
  'keys',
  'privatekey',
  'key',
  'recoverycodes',
  'recoverycode',
  'recovery',
  'privatenotes',
  'privatenote',
  'internalnote',
  'internalnotes',
  'note',
  'reports',
  'report',
  'credentials',
  'credential',
  'cardnumber',
  'cvv',
  'plaintext',
  'privatekey',
]);

function normalizeField(field: string): string {
  return String(field).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isC3Field(field: string): boolean {
  const norm = normalizeField(field);
  if (!norm) return false;
  if (C3_FIELD_NAMES.has(norm)) return true;

  // Enum values themselves
  for (const v of Object.values(C3_CLASSIFIED)) {
    if (normalizeField(v) === norm) return true;
  }

  // Heuristic keyword containment
  if (norm.includes('message') && (norm.includes('plaintext') || norm.includes('body') || norm.includes('content') || norm.includes('text'))) return true;
  if (norm.includes('attachment') && (norm.includes('metadata') || norm.includes('filename') || norm.includes('mime') || norm.includes('size') || norm.includes('path') || norm.includes('url'))) return true;
  if (norm.includes('auth') || norm.includes('token') || norm.includes('password') || norm.includes('secret') || norm.includes('otp') || norm.includes('cookie') || norm.includes('authorization') || norm.includes('session')) return true;
  if (norm.includes('key')) return true;
  if (norm.includes('recovery')) return true;
  if (norm.includes('privatenote') || norm.includes('internalnote')) return true;
  if (norm === 'note' || norm.includes('privatenotes')) return true;
  if (norm.includes('report')) return true;
  if (norm.includes('credential') || norm.includes('cardnumber') || norm.includes('cvv')) return true;
  if (norm.includes('plaintext')) return true;

  return false;
}

export function redactC3Fields(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isC3Field(key)) {
      result[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? redactC3Fields(item as Record<string, unknown>)
          : item
      );
    } else if (value && typeof value === 'object') {
      result[key] = redactC3Fields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
