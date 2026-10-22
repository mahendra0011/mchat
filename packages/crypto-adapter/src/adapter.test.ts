import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WebCryptoAdapter } from './adapter.js';
import { generateSafetyNumber } from './safety-number.js';
import { KeyHierarchyManager } from './key-hierarchy.js';
import { DoubleRatchetSession, generateEphemeralKeyPair, deriveSharedSecret } from './double-ratchet.js';

describe('WebCryptoAdapter', () => {
  const adapter = new WebCryptoAdapter();

  it('generates, exports, and imports keys', async () => {
    const key = await adapter.generateSymmetricKey();
    assert.ok(key);

    const exported = await adapter.exportKey(key);
    assert.strictEqual(typeof exported, 'string');
    assert.ok(exported.length > 20);

    const imported = await adapter.importKey(exported);
    assert.ok(imported);
  });

  it('encrypts and decrypts text accurately with AES-256-GCM', async () => {
    const key = await adapter.generateSymmetricKey();
    const plaintext = 'Secret privacy-sensitive message for Orbit Chat';

    const encrypted = await adapter.encrypt(plaintext, key);
    assert.strictEqual(encrypted.algorithm, 'AES-256-GCM');
    assert.notStrictEqual(encrypted.ciphertextBase64, plaintext);

    const decrypted = await adapter.decrypt(encrypted, key);
    assert.strictEqual(decrypted, plaintext);
  });

  it('computes SHA-256 hex digests consistently', async () => {
    const hash1 = await adapter.digestSha256('hello-orbit');
    const hash2 = await adapter.digestSha256('hello-orbit');
    const hash3 = await adapter.digestSha256('different-text');

    assert.strictEqual(hash1, hash2);
    assert.notStrictEqual(hash1, hash3);
    assert.strictEqual(hash1.length, 64);
  });

  it('generates deterministic symmetric safety numbers regardless of party order', async () => {
    const keyUser1 = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUser1PublicKeyBase64SampleDataStringABC123';
    const keyUser2 = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUser2PublicKeyBase64SampleDataStringXYZ789';

    const resultA = await generateSafetyNumber(keyUser1, keyUser2);
    const resultB = await generateSafetyNumber(keyUser2, keyUser1);

    assert.strictEqual(resultA.numericCode, resultB.numericCode);
    assert.strictEqual(resultA.qrPayload, resultB.qrPayload);
    // Matches 12 blocks of 5 digits format
    assert.match(resultA.numericCode, /^\d{5}( \d{5}){11}$/);
  });

  it('derives domain-separated subkeys and encrypts attachments', async () => {
    const hierarchy = new KeyHierarchyManager();
    const masterSecret = new Uint8Array(32).fill(7);

    const attachmentKey = await hierarchy.deriveSubkey(masterSecret, 'orbit:v1:attachment_key');
    const senderKey = await hierarchy.deriveSubkey(masterSecret, 'orbit:v1:group_sender_key');

    assert.ok(attachmentKey);
    assert.ok(senderKey);

    const fileData = new TextEncoder().encode('Confidential audited attachment bytes');
    const encryptedAttachment = await hierarchy.encryptAttachment(fileData, attachmentKey);

    assert.strictEqual(encryptedAttachment.byteLength, fileData.byteLength);
    assert.strictEqual(encryptedAttachment.sha256DigestHex.length, 64);

    const decrypted = await hierarchy.decryptAttachment(encryptedAttachment, attachmentKey);
    assert.deepStrictEqual(decrypted, fileData);
  });
});

describe('DoubleRatchetSession (WAVE-G E2EE)', () => {
  it('completes ECDH + ratchet encrypt/decrypt roundtrip', async () => {
    const alice = await generateEphemeralKeyPair();
    const bob = await generateEphemeralKeyPair();

    const sharedA = await deriveSharedSecret(alice.privateKey, bob.publicKeyRaw);
    const sharedB = await deriveSharedSecret(bob.privateKey, alice.publicKeyRaw);
    assert.deepStrictEqual(sharedA, sharedB);

    const sessionA = await DoubleRatchetSession.initiate(sharedA);
    const sessionB = await DoubleRatchetSession.respond(sharedB);

    const m1 = await sessionA.encrypt('Hello from Alice');
    assert.strictEqual(m1.algorithm, 'AES-256-GCM-DR');
    const d1 = await sessionB.decrypt(m1);
    assert.strictEqual(d1, 'Hello from Alice');

    const m2 = await sessionB.encrypt('Reply from Bob');
    const d2 = await sessionA.decrypt(m2);
    assert.strictEqual(d2, 'Reply from Bob');
  });

  it('supports multiple sequential messages in one chain', async () => {
    const alice = await generateEphemeralKeyPair();
    const bob = await generateEphemeralKeyPair();
    const shared = await deriveSharedSecret(alice.privateKey, bob.publicKeyRaw);

    const sessionA = await DoubleRatchetSession.initiate(shared);
    const sessionB = await DoubleRatchetSession.respond(shared);

    for (let i = 0; i < 5; i++) {
      const msg = await sessionA.encrypt(`msg-${i}`);
      const plain = await sessionB.decrypt(msg);
      assert.strictEqual(plain, `msg-${i}`);
    }
  });

  it('serializes and restores session state (device migration)', async () => {
    const alice = await generateEphemeralKeyPair();
    const bob = await generateEphemeralKeyPair();
    const shared = await deriveSharedSecret(alice.privateKey, bob.publicKeyRaw);

    const sessionA = await DoubleRatchetSession.initiate(shared);
    const sessionB = await DoubleRatchetSession.respond(shared);

    // Alice sends one message, Bob receives it
    const m1 = await sessionA.encrypt('before-migration');
    await sessionB.decrypt(m1);

    // Save Alice's state after send, restore on "new device"
    const saved = sessionA.getState();
    const restored = DoubleRatchetSession.fromState(saved);

    // Restored Alice sends next message; Bob (same chain position) receives it
    const m2 = await restored.encrypt('after-migration');
    const d2 = await sessionB.decrypt(m2);
    assert.strictEqual(d2, 'after-migration');
  });
});
