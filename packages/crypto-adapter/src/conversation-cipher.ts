/**
 * Conversation envelope cipher for client-side E2EE (Spec 10/31).
 *
 * Encrypts a message body with a per-conversation AES-256-GCM key and serializes
 * it to a self-describing string that can be stored/served by the server as-is
 * (the server only ever sees ciphertext). On read, the recipient detects the
 * envelope, decrypts it locally, and renders plaintext.
 *
 * The envelope format is:
 *
 *     orbit.e2ee.v1.<iv-base64>.<ciphertext-base64>
 *
 * Base64 helpers here are deliberately Buffer-free and work in both Node (tests)
 * and the browser (web client), where `Buffer` is unavailable.
 */

import { b64ToBytes, bytesToB64, toBuf } from './bytes.js';

const ENVELOPE_PREFIX = 'orbit.e2ee.v1.';

/** True when a string looks like a conversation encryption envelope. */
export function isEncryptedEnvelope(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

export class ConversationCipher {
  private key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.key = key;
  }

  /** Generate a fresh 256-bit raw key, returned base64 (persist/share this). */
  static async generateRawKey(): Promise<string> {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await subtle.exportKey('raw', key);
    return bytesToB64(new Uint8Array(raw));
  }

  /** Load a cipher from a base64 raw key (as produced by {@link generateRawKey}). */
  static async fromRawKey(rawKeyB64: string): Promise<ConversationCipher> {
    const subtle = globalThis.crypto.subtle;
    const raw = b64ToBytes(rawKeyB64);
    const key = await subtle.importKey('raw', toBuf(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return new ConversationCipher(key);
  }

  /** Encrypt a plaintext body into an envelope string. */
  async encrypt(plaintext: string): Promise<string> {
    const subtle = globalThis.crypto.subtle;
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv: toBuf(iv) }, this.key, new TextEncoder().encode(plaintext));
    return `${ENVELOPE_PREFIX}${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
  }

  /**
   * Decrypt an envelope back to plaintext. Throws for non-envelopes, malformed
   * payloads, or authentication failure (wrong key / tampered ciphertext).
   */
  async decrypt(envelope: string): Promise<string> {
    if (!isEncryptedEnvelope(envelope)) throw new Error('not an encrypted envelope');
    const rest = envelope.slice(ENVELOPE_PREFIX.length);
    const sep = rest.indexOf('.');
    if (sep < 0) throw new Error('malformed envelope: missing iv separator');

    const iv = b64ToBytes(rest.slice(0, sep));
    const ct = b64ToBytes(rest.slice(sep + 1));
    const subtle = globalThis.crypto.subtle;
    const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv: toBuf(iv) }, this.key, toBuf(ct));
    return new TextDecoder().decode(plaintext);
  }
}
