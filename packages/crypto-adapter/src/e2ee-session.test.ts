import { describe, it } from 'node:test';
import assert from 'node:assert';
import { E2eeSessionManager } from './e2ee-session.js';
import { generateEphemeralKeyPair, deriveSharedSecret } from './double-ratchet.js';

async function makeSharedSecret(): Promise<Uint8Array> {
  const a = await generateEphemeralKeyPair();
  const b = await generateEphemeralKeyPair();
  return await deriveSharedSecret(a.privateKey, b.publicKeyRaw);
}

describe('E2eeSessionManager (WAVE-9 client E2EE wiring)', () => {
  it('establishes per-conversation sessions and round-trips both directions', async () => {
    const secret = await makeSharedSecret();
    const conv = 'conv_1';

    const alice = new E2eeSessionManager();
    const bob = new E2eeSessionManager();
    await alice.establish(conv, secret, 'initiator');
    await bob.establish(conv, secret, 'responder');

    const out = await alice.encrypt(conv, 'ping over ratchet');
    assert.strictEqual(out.algorithm, 'AES-256-GCM-DR');
    assert.notStrictEqual(out.ciphertextBase64, 'ping over ratchet');
    assert.strictEqual(await bob.decrypt(conv, out), 'ping over ratchet');

    const reply = await bob.encrypt(conv, 'pong over ratchet');
    assert.strictEqual(await alice.decrypt(conv, reply), 'pong over ratchet');
  });

  it('feeds decrypted plaintext to the onDecrypted hook (local search index)', async () => {
    const secret = await makeSharedSecret();
    const conv = 'conv_idx';
    const seen: Array<{ conversationId: string; plaintext: string }> = [];

    const sender = new E2eeSessionManager();
    const receiver = new E2eeSessionManager({
      onDecrypted: (conversationId, plaintext) => seen.push({ conversationId, plaintext }),
    });
    await sender.establish(conv, secret, 'initiator');
    await receiver.establish(conv, secret, 'responder');

    const msg = await sender.encrypt(conv, 'indexable secret words');
    await receiver.decrypt(conv, msg);

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0]!.conversationId, conv);
    assert.strictEqual(seen[0]!.plaintext, 'indexable secret words');
  });

  it('throws when decrypting without an established session', async () => {
    const manager = new E2eeSessionManager();
    const msg = await (async () => {
      const secret = await makeSharedSecret();
      const tmp = new E2eeSessionManager();
      await tmp.establish('conv_x', secret, 'initiator');
      return tmp.encrypt('conv_x', 'never delivered');
    })();

    await assert.rejects(
      () => manager.decrypt('conv_missing', msg),
      /No E2EE session/
    );
  });

  it('exports and imports session state for device migration mid-conversation', async () => {
    const secret = await makeSharedSecret();
    const conv = 'conv_migrate';

    const alice = new E2eeSessionManager();
    const bob = new E2eeSessionManager();
    await alice.establish(conv, secret, 'initiator');
    await bob.establish(conv, secret, 'responder');

    const m1 = await alice.encrypt(conv, 'before-migration');
    await bob.decrypt(conv, m1);

    // "New device" restores Alice's exported state.
    const restored = E2eeSessionManager.importState(alice.exportState());
    assert.ok(restored.hasSession(conv));

    const m2 = await restored.encrypt(conv, 'after-migration');
    assert.strictEqual(await bob.decrypt(conv, m2), 'after-migration');
  });

  it('drop() forgets a conversation session', async () => {
    const secret = await makeSharedSecret();
    const conv = 'conv_drop';
    const manager = new E2eeSessionManager();
    await manager.establish(conv, secret, 'initiator');
    assert.ok(manager.hasSession(conv));
    manager.drop(conv);
    assert.ok(!manager.hasSession(conv));
  });

  it('maintains independent sessions per conversation', async () => {
    const secret = await makeSharedSecret();
    const manager = new E2eeSessionManager();
    await manager.establish('conv_a', secret, 'initiator');
    assert.ok(manager.hasSession('conv_a'));
    assert.ok(!manager.hasSession('conv_b'));
  });
});
