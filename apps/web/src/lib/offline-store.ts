/**
 * Offline message cache for the web app (Spec 10 — client-side offline caching).
 *
 * Persists the last-known server state of a conversation (wire messages plus any
 * decrypted E2EE plaintext) in IndexedDB via the shared local cache, so a reload
 * or failed fetch still renders the conversation instead of empty fixtures.
 * Everything stays on-device; nothing here touches the network.
 */

import { createLocalCache, type LocalCache } from '@orbit/domain';
import type { MessageEnvelope } from '@orbit/schemas';

const cache: LocalCache = createLocalCache('orbit-cache');

const MESSAGES_PREFIX = 'msgs:';
const DECRYPTED_PREFIX = 'e2ee:decrypted:';

export async function cacheMessages(conversationId: string, messages: MessageEnvelope[]): Promise<void> {
  try {
    await cache.set(`${MESSAGES_PREFIX}${conversationId}`, messages);
  } catch {
    // Quota / private-mode failures must never break the UI.
  }
}

export async function readCachedMessages(conversationId: string): Promise<MessageEnvelope[] | null> {
  try {
    const msgs = await cache.get<MessageEnvelope[]>(`${MESSAGES_PREFIX}${conversationId}`);
    return Array.isArray(msgs) && msgs.length > 0 ? msgs : null;
  } catch {
    return null;
  }
}

export async function cacheDecryptedBodies(
  conversationId: string,
  decrypted: Record<string, string>,
): Promise<void> {
  try {
    await cache.set(`${DECRYPTED_PREFIX}${conversationId}`, decrypted);
  } catch {
    // Best effort only.
  }
}

export async function readCachedDecryptedBodies(conversationId: string): Promise<Record<string, string>> {
  try {
    const record = await cache.get<Record<string, string>>(`${DECRYPTED_PREFIX}${conversationId}`);
    return record && typeof record === 'object' ? record : {};
  } catch {
    return {};
  }
}
