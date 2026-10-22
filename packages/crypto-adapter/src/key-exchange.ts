/**
 * Client-side E2EE key-exchange primitives (Spec 10/31).
 *
 * These are the pure crypto building blocks for the key-exchange flow the web
 * client runs when an encrypted conversation is opened:
 *
 *   1. generate an identity P-256 key pair (publish the SPKI public key),
 *   2. ECDH it with the contact's identity key (imported as SPKI, so invalid /
 *      fixture placeholder keys are rejected by WebCrypto),
 *   3. HKDF the shared secret into a per-conversation AES-256-GCM key.
 *
 * Callers must handle {@link deriveSharedSecretFromSpki} throwing (invalid or
 * placeholder peer keys) and fall back to a locally generated conversation key.
 * Everything here is Buffer-free and works in Node (tests) and the browser.
 */

import { b64ToBytes, bytesToB64, toBuf } from './bytes.js';

export interface IdentityKeyPairRaw {
  privateKey: CryptoKey;
  /** SPKI (DER) public key, base64 — publish this as `identityKeyPub`. */
  spkiB64: string;
}

/** Generate an identity key pair used for ECDH over P-256. */
export async function generateIdentityKeyPairRaw(): Promise<IdentityKeyPairRaw> {
  const subtle = globalThis.crypto.subtle;
  const pair = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const spki = await subtle.exportKey('spki', pair.publicKey);
  return { privateKey: pair.privateKey, spkiB64: bytesToB64(new Uint8Array(spki)) };
}

/** Re-import a persisted PKCS8 private key (base64). */
export async function importIdentityPrivateKey(pkcs8B64: string): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const der = b64ToBytes(pkcs8B64);
  return subtle.importKey('pkcs8', toBuf(der), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

/** Export an identity private key to base64 PKCS8 (persist this). */
export async function exportIdentityPrivateKey(privateKey: CryptoKey): Promise<string> {
  const der = await globalThis.crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToB64(new Uint8Array(der));
}

/**
 * ECDH the local identity private key against a peer's SPKI public key.
 *
 * Returns the raw ECDH shared secret (P-256). Throws when the peer key is not a
 * valid P-256 SPKI (e.g. seeded fixture placeholders), so callers can fall back.
 */
export async function deriveSharedSecretFromSpki(
  privateKey: CryptoKey,
  peerSpkiB64: string,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const der = b64ToBytes(peerSpkiB64);
  const peerPub = await subtle.importKey(
    'spki',
    toBuf(der),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peerPub }, privateKey, 256);
  return new Uint8Array(bits);
}

/**
 * HKDF-SHA-256 the shared secret into a 32-byte AES key for one conversation,
 * returned base64 (feed it to {@link ConversationCipher.fromRawKey}).
 */
export async function hkdfConversationKey(sharedSecret: Uint8Array, conversationId: string): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const baseKey = await subtle.importKey('raw', toBuf(sharedSecret), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('orbit:v1:e2ee'),
      info: new TextEncoder().encode(conversationId),
    },
    baseKey,
    256,
  );
  return bytesToB64(new Uint8Array(bits));
}
