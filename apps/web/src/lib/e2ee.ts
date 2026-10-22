/**
 * Client-side E2EE key exchange + message encryption for the web app (Spec 10/31).
 *
 * Flow:
 *  1. On first use the device generates (or loads) a persisted P-256 identity
 *     key pair and publishes the SPKI public key to the server key bundle.
 *  2. Opening an E2EE conversation fetches each peer's key bundle (by their
 *     participant workspace), runs ECDH, HKDFs a per-conversation AES-256-GCM
 *     key, and caches it locally so history stays decryptable across reloads.
 *  3. Sends encrypt the body into an `orbit.e2ee.v1.*` envelope (the server
 *     only ever stores ciphertext); loads decrypt envelopes back to plaintext.
 *
 * Fallbacks keep the demo unbreakable: fixture/placeholder peer keys are
 * rejected by WebCrypto and produce a locally generated conversation key;
 * non-envelope bodies (legacy plaintext, attachment names) render as-is;
 * envelopes that fail to decrypt render {@link UNDECRYPTABLE_PLACEHOLDER}.
 */

import {
  ConversationCipher,
  deriveSharedSecretFromSpki,
  exportIdentityPrivateKey,
  generateIdentityKeyPairRaw,
  hkdfConversationKey,
  importIdentityPrivateKey,
  isEncryptedEnvelope,
} from '@orbit/crypto-adapter';
import { createLocalCache, type LocalCache } from '@orbit/domain';
import type { Conversation, MessageEnvelope } from '@orbit/schemas';
import type { OrbitHttpClient } from '@orbit/api-client';

export const UNDECRYPTABLE_PLACEHOLDER = '(unable to decrypt message)';

const IDENTITY_PRIVATE_KEY = 'e2ee:identity:private';
const IDENTITY_PUBLIC_KEY = 'e2ee:identity:public';

const cache: LocalCache = createLocalCache('orbit-cache');

let identityPromise: Promise<{ privateKey: CryptoKey; spkiB64: string }> | null = null;
let identityPublished = false;
const cipherCache = new Map<string, ConversationCipher>();

function loadIdentity() {
  if (identityPromise) return identityPromise;
  identityPromise = (async () => {
    const storedPrivate = await cache.get<string>(IDENTITY_PRIVATE_KEY);
    const storedPublic = await cache.get<string>(IDENTITY_PUBLIC_KEY);
    if (storedPrivate && storedPublic) {
      return { privateKey: await importIdentityPrivateKey(storedPrivate), spkiB64: storedPublic };
    }
    const pair = await generateIdentityKeyPairRaw();
    await cache.set(IDENTITY_PRIVATE_KEY, await exportIdentityPrivateKey(pair.privateKey));
    await cache.set(IDENTITY_PUBLIC_KEY, pair.spkiB64);
    return { privateKey: pair.privateKey, spkiB64: pair.spkiB64 };
  })();
  return identityPromise;
}

/** Publish this device's identity public key (best effort, once per session). */
export async function publishIdentityKey(http: OrbitHttpClient): Promise<void> {
  if (identityPublished) return;
  try {
    const identity = await loadIdentity();
    await http.registerKeyBundle({
      identityKeyPub: identity.spkiB64,
      signedPreKeyPub: identity.spkiB64,
      deviceId: 'dev_web_current',
    });
    identityPublished = true;
  } catch {
    // Backend may be unreachable or already seeded; identity stays local either way.
  }
}

function peerWorkspaceIds(conversation: Conversation, myWorkspaceId: string): string[] {
  return conversation.participants
    .filter((p) => p.workspaceId !== myWorkspaceId)
    .map((p) => p.workspaceId);
}

/**
 * Derive (or recover from cache) the shared conversation key.
 *
 * Real path: ECDH(identity, each peer bundle) → sorted pairwise secrets →
 * HKDF(conversationId). When no peer key can be used (offline, placeholder
 * bundle) a locally generated key keeps the conversation working on-device.
 */
async function deriveConversationRawKey(
  http: OrbitHttpClient,
  conversation: Conversation,
  myWorkspaceId: string,
): Promise<string> {
  const stored = await cache.get<string>(`e2ee:key:${conversation.id}`);
  if (stored) return stored;

  let rawKey: string | null = null;
  const secrets: Uint8Array[] = [];

  try {
    const identity = await loadIdentity();
    const peers = peerWorkspaceIds(conversation, myWorkspaceId);
    const bundles = await Promise.all(
      peers.map(async (workspaceId) => {
        try {
          return await http.getKeyBundleForWorkspace(workspaceId);
        } catch {
          return null;
        }
      })
    );
    for (const bundle of bundles) {
      if (!bundle?.identityKeyPub) continue;
      try {
        secrets.push(await deriveSharedSecretFromSpki(identity.privateKey, bundle.identityKeyPub));
      } catch {
        // Placeholder / rotated peer key — skip this peer.
      }
    }
    if (secrets.length > 0) {
      secrets.sort((a, b) => {
        const x = a.subarray(0, 8);
        const y = b.subarray(0, 8);
        for (let i = 0; i < 8; i++) {
          if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
        }
        return 0;
      });
      const combined = new Uint8Array(secrets.reduce((n, s) => n + s.length, 0));
      let offset = 0;
      for (const s of secrets) {
        combined.set(s, offset);
        offset += s.length;
      }
      rawKey = await hkdfConversationKey(combined, conversation.id);
    }
  } catch {
    rawKey = null;
  }

  if (!rawKey) {
    rawKey = await ConversationCipher.generateRawKey();
  }
  await cache.set(`e2ee:key:${conversation.id}`, rawKey);
  return rawKey;
}

/** Get (establishing on first use) the cipher for an E2EE conversation. */
export async function getConversationCipher(
  http: OrbitHttpClient,
  conversation: Conversation,
  myWorkspaceId: string,
): Promise<ConversationCipher> {
  const cached = cipherCache.get(conversation.id);
  if (cached) return cached;

  await publishIdentityKey(http);
  const rawKey = await deriveConversationRawKey(http, conversation, myWorkspaceId);
  const cipher = await ConversationCipher.fromRawKey(rawKey);
  cipherCache.set(conversation.id, cipher);
  return cipher;
}

/** Encrypt a message body for the wire (returns an envelope). */
export async function encryptMessageBody(
  http: OrbitHttpClient,
  conversation: Conversation,
  myWorkspaceId: string,
  plaintext: string,
): Promise<string> {
  const cipher = await getConversationCipher(http, conversation, myWorkspaceId);
  return cipher.encrypt(plaintext);
}

/**
 * Decrypt every encrypted envelope in a loaded batch.
 * Returns a message-id → plaintext record; envelopes that will not decrypt map
 * to {@link UNDECRYPTABLE_PLACEHOLDER}. Non-envelope bodies are omitted (the
 * raw body already displays correctly).
 */
export async function decryptMessageBodies(
  cipher: ConversationCipher,
  messages: MessageEnvelope[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const msg of messages) {
    if (!isEncryptedEnvelope(msg.body)) continue;
    try {
      out[msg.id] = await cipher.decrypt(msg.body);
    } catch {
      out[msg.id] = UNDECRYPTABLE_PLACEHOLDER;
    }
  }
  return out;
}
