import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationCipher, isEncryptedEnvelope } from './conversation-cipher.js';

describe('ConversationCipher (WAVE-9 E2EE envelope)', () => {
  it('round-trips plaintext to ciphertext and back', async () => {
    const rawKey = await ConversationCipher.generateRawKey();
    const cipher = await ConversationCipher.fromRawKey(rawKey);

    const envelope = await cipher.encrypt('secret team message');
    assert.notStrictEqual(envelope, 'secret team message');
    assert.ok(isEncryptedEnvelope(envelope), 'produces a recognisable envelope');
    assert.match(envelope, /^orbit\.e2ee\.v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);

    assert.strictEqual(await cipher.decrypt(envelope), 'secret team message');
  });

  it('isEncryptedEnvelope rejects plaintext and malformed values', () => {
    assert.equal(isEncryptedEnvelope('hello world'), false);
    assert.equal(isEncryptedEnvelope(''), false);
    assert.equal(isEncryptedEnvelope(undefined), false);
    assert.equal(isEncryptedEnvelope(42), false);
    assert.equal(isEncryptedEnvelope('orbit.e2ee.v2.aa.bb'), false, 'only v1 is recognised');
  });

  it('produces a different envelope each time (random IV)', async () => {
    const rawKey = await ConversationCipher.generateRawKey();
    const cipher = await ConversationCipher.fromRawKey(rawKey);
    const a = await cipher.encrypt('same plaintext');
    const b = await cipher.encrypt('same plaintext');
    assert.notStrictEqual(a, b, 'IVs must differ so identical plaintext does not leak');
    assert.strictEqual(await cipher.decrypt(a), 'same plaintext');
    assert.strictEqual(await cipher.decrypt(b), 'same plaintext');
  });

  it('fails to decrypt with a different key', async () => {
    const cipherA = await ConversationCipher.fromRawKey(await ConversationCipher.generateRawKey());
    const cipherB = await ConversationCipher.fromRawKey(await ConversationCipher.generateRawKey());
    const envelope = await cipherA.encrypt('only A can read this');
    await assert.rejects(() => cipherB.decrypt(envelope), 'authentication must fail for the wrong key');
  });

  it('throws on non-envelope and malformed input', async () => {
    const cipher = await ConversationCipher.fromRawKey(await ConversationCipher.generateRawKey());
    await assert.rejects(() => cipher.decrypt('plain text'), /not an encrypted envelope/);
    await assert.rejects(
      () => cipher.decrypt('orbit.e2ee.v1.noseparator'),
      /malformed envelope/
    );
  });

  it('handles empty and unicode payloads', async () => {
    const cipher = await ConversationCipher.fromRawKey(await ConversationCipher.generateRawKey());
    assert.strictEqual(await cipher.decrypt(await cipher.encrypt('')), '');

    const unicode = 'नमस्ते 🌍 — emoji + devanagari';
    assert.strictEqual(await cipher.decrypt(await cipher.encrypt(unicode)), unicode);
  });
});
