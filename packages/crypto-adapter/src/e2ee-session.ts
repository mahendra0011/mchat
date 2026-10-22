import {
  DoubleRatchetSession,
  type RatchetMessage,
  type RatchetSessionState,
} from './double-ratchet.js';

/**
 * Application-level E2EE session manager (Spec 10/31 — client E2EE wiring).
 *
 * The `DoubleRatchetSession` already implements the cryptographic ratchet itself.
 * This layer manages one session per conversation on a device, exposes a simple
 * `encrypt`/`decrypt` API for the message send/receive path, invokes a callback on
 * every decrypt (so callers can feed plaintext into a local-only search index), and
 * supports exporting/importing session state for device migration.
 *
 * Key exchange (ECDH with a peer's public key) is intentionally external: callers
 * pass an established `sharedSecret` into `establish()`. That lets the real key
 * transport (prekey bundles, QR handshake, …) be swapped in without touching this
 * class, while the ratchet + per-conversation bookkeeping stay tested here.
 */

export type E2eeRole = 'initiator' | 'responder';

interface ActiveSession {
  role: E2eeRole;
  session: DoubleRatchetSession;
}

export interface E2eeSessionManagerOptions {
  /**
   * Called with the plaintext of every message this device successfully decrypts.
   * Typically used to add the message to an on-device, local-only search index —
   * the plaintext never leaves this callback.
   */
  onDecrypted?: (conversationId: string, plaintext: string) => void;
}

export class E2eeSessionManager {
  private sessions = new Map<string, ActiveSession>();
  private onDecrypted?: (conversationId: string, plaintext: string) => void;

  constructor(opts: E2eeSessionManagerOptions = {}) {
    this.onDecrypted = opts.onDecrypted;
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  /** Establish (or replace) the ratchet for a conversation from a shared secret. */
  async establish(
    conversationId: string,
    sharedSecret: Uint8Array,
    role: E2eeRole = 'initiator'
  ): Promise<void> {
    const session =
      role === 'initiator'
        ? await DoubleRatchetSession.initiate(sharedSecret)
        : await DoubleRatchetSession.respond(sharedSecret);
    this.sessions.set(conversationId, { role, session });
  }

  private requireSession(conversationId: string): DoubleRatchetSession {
    const active = this.sessions.get(conversationId);
    if (!active) {
      throw new Error(`No E2EE session established for conversation ${conversationId}`);
    }
    return active.session;
  }

  /** Encrypt an outgoing message body for a conversation. */
  async encrypt(conversationId: string, plaintext: string): Promise<RatchetMessage> {
    return this.requireSession(conversationId).encrypt(plaintext);
  }

  /** Decrypt an incoming message body and notify the local index via `onDecrypted`. */
  async decrypt(conversationId: string, msg: RatchetMessage): Promise<string> {
    const plaintext = await this.requireSession(conversationId).decrypt(msg);
    this.onDecrypted?.(conversationId, plaintext);
    return plaintext;
  }

  /** Forget a conversation's session (e.g. after the chat is deleted). */
  drop(conversationId: string): void {
    this.sessions.delete(conversationId);
  }

  /** Serialize all session state for device migration / persistence. */
  exportState(): string {
    const payload: Record<string, { role: E2eeRole; state: RatchetSessionState }> = {};
    for (const [conversationId, { role, session }] of this.sessions) {
      payload[conversationId] = { role, state: session.getState() };
    }
    return JSON.stringify(payload);
  }

  /** Restore sessions exported by {@link exportState}. */
  static importState(json: string, opts: E2eeSessionManagerOptions = {}): E2eeSessionManager {
    const manager = new E2eeSessionManager(opts);
    const payload = JSON.parse(json) as Record<string, { role: E2eeRole; state: RatchetSessionState }>;
    for (const [conversationId, { role, state }] of Object.entries(payload)) {
      manager.sessions.set(conversationId, { role, session: DoubleRatchetSession.fromState(state) });
    }
    return manager;
  }
}
