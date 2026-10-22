import { DeletionTombstone, RestoreReconciliationReport } from '@orbit/schemas';

/**
 * Retention, Disappearing Messages, and Deletion Tombstone Ledger (Specs 37 & 41)
 * Guarantees:
 * - Data retention expiration calculation.
 * - Hashed deletion tombstones for GDPR erasure compliance.
 * - Restore reconciliation: prevents deleted data from resurrecting when an older backup is restored.
 * - Fully isomorphic runtime execution across Node.js, browsers, and mobile runtimes.
 */

function deterministicHash64(input: string): string {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h0 = Math.imul(h0 ^ code, 0x5bd1e995);
    h1 = Math.imul(h1 ^ (code << 3), 0x1b873593);
    h2 = Math.imul(h2 ^ (code << 7), 0x85ebca6b);
    h3 = Math.imul(h3 ^ (code << 11), 0xc2b2ae35);
    h4 = Math.imul(h4 ^ (code >> 2), 0x27d4eb2f);
    h5 = Math.imul(h5 ^ (code >> 5), 0x165667b1);
    h6 = Math.imul(h6 ^ (code >> 1), 0x9e3779b9);
    h7 = Math.imul(h7 ^ (code << 13), 0x7feb352d);
  }

  const toHex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex8(h0)}${toHex8(h1)}${toHex8(h2)}${toHex8(h3)}${toHex8(h4)}${toHex8(h5)}${toHex8(h6)}${toHex8(h7)}`;
}

export function calculateExpiryDate(
  createdAtIso: string,
  retentionDays: number | null | undefined
): string | null {
  if (!retentionDays || retentionDays <= 0) return null;
  const created = new Date(createdAtIso).getTime();
  const expiresAt = created + retentionDays * 24 * 60 * 60 * 1000;
  return new Date(expiresAt).toISOString();
}

export function isMessageExpired(
  createdAtIso: string,
  retentionDays: number | null | undefined
): boolean {
  const expiry = calculateExpiryDate(createdAtIso, retentionDays);
  if (!expiry) return false;
  return Date.now() >= new Date(expiry).getTime();
}

export class DeletionTombstoneLedger {
  private tombstones: Map<string, DeletionTombstone> = new Map();

  recordTombstone(
    targetType: 'message' | 'attachment' | 'user' | 'workspace' | 'session',
    targetId: string,
    workspaceId: string,
    reason: 'user_delete' | 'retention_expiry' | 'gdpr_erasure'
  ): DeletionTombstone {
    const targetIdHash = deterministicHash64(targetId);
    const tombstoneId = `tmb-${targetIdHash.substring(0, 12)}-${Date.now()}`;
    const deletedAt = new Date().toISOString();

    const tombstoneHash = deterministicHash64(
      `${targetType}:${targetIdHash}:${workspaceId}:${deletedAt}:${reason}`
    );

    const tombstone: DeletionTombstone = {
      tombstoneId,
      targetType,
      targetIdHash,
      workspaceId,
      deletedAt,
      reason,
      tombstoneHash,
    };

    this.tombstones.set(targetIdHash, tombstone);
    return tombstone;
  }

  isTombstoned(targetId: string): boolean {
    const hash = deterministicHash64(targetId);
    return this.tombstones.has(hash);
  }

  getAllTombstones(): DeletionTombstone[] {
    return Array.from(this.tombstones.values());
  }

  /**
   * Rehydrate tombstones from a durable store (Spec 10 boot hydration).
   * Accepts full tombstone rows and restores them into the working ledger.
   */
  hydrate(tombstones: DeletionTombstone[]): void {
    for (const tombstone of tombstones) {
      this.tombstones.set(tombstone.targetIdHash, tombstone);
    }
  }

  /**
   * Reconciles candidate records from an older backup against active tombstones.
   * Any record that was tombstoned is permanently suppressed from restoration (Spec 41).
   */
  reconcileRestore<T extends { id: string }>(
    candidateRecords: T[]
  ): { preservedRecords: T[]; report: RestoreReconciliationReport } {
    let suppressedCount = 0;
    const preservedRecords: T[] = [];

    for (const record of candidateRecords) {
      if (this.isTombstoned(record.id)) {
        suppressedCount++;
      } else {
        preservedRecords.push(record);
      }
    }

    const report: RestoreReconciliationReport = {
      restoredRecordsCount: candidateRecords.length,
      suppressedTombstoneCount: suppressedCount,
      preservedRecordsCount: preservedRecords.length,
      reconciledAt: new Date().toISOString(),
    };

    return { preservedRecords, report };
  }
}
