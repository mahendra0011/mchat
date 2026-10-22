import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { b64ToBytes, toBuf } from './bytes.js';
import {
  deriveSharedSecretFromSpki,
  exportIdentityPrivateKey,
  generateIdentityKeyPairRaw,
  hkdfConversationKey,
  importIdentityPrivateKey,
} from './key-exchange.js';

describe('key exchange (WAVE-9)', () => {
  it('generates an identity pair whose SPKI public key re-imports', async () => {
    const a = await generateIdentityKeyPairRaw();
    const spki = b64ToBytes(a.spkiB64);
    assert.ok(spki.length > 0);
    const imported = await globalThis.crypto.subtle.importKey(
      'spki',
      toBuf(spki),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    assert.ok(imported);
  });

  it('agrees on a shared secret (ECDH symmetry) between two peers', async () => {
    const a = await generateIdentityKeyPairRaw();
    const b = await generateIdentityKeyPairRaw();
    const secretFromA = await deriveSharedSecretFromSpki(a.privateKey, b.spkiB64);
    const secretFromB = await deriveSharedSecretFromSpki(b.privateKey, a.spkiB64);
    assert.deepEqual(secretFromA, secretFromB);
    assert.equal(secretFromA.length, 32);
  });

  it('round-trips a persisted private key to the same shared secret', async () => {
    const a = await generateIdentityKeyPairRaw();
    const b = await generateIdentityKeyPairRaw();
    const before = await deriveSharedSecretFromSpki(a.privateKey, b.spkiB64);
    const reimported = await importIdentityPrivateKey(await exportIdentityPrivateKey(a.privateKey));
    const after = await deriveSharedSecretFromSpki(reimported, b.spkiB64);
    assert.deepEqual(after, before);
  });

  it('rejects an invalid / placeholder peer key (fixture samples)', async () => {
    const a = await generateIdentityKeyPairRaw();
    const placeholder =
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAlexIdentityPublicKeySample64BytesStringBase64==';
    await assert.rejects(() => deriveSharedSecretFromSpki(a.privateKey, placeholder));
  });

  it('derives deterministic 32-byte conversation keys scoped per conversation', async () => {
    const a = await generateIdentityKeyPairRaw();
    const b = await generateIdentityKeyPairRaw();
    const shared = await deriveSharedSecretFromSpki(a.privateKey, b.spkiB64);

    const k1 = await hkdfConversationKey(shared, 'conv_1');
    const k1Again = await hkdfConversationKey(shared, 'conv_1');
    const k2 = await hkdfConversationKey(shared, 'conv_2');

    assert.equal(k1, k1Again);
    assert.notEqual(k1, k2);
    assert.equal(b64ToBytes(k1).length, 32);
  });
});
