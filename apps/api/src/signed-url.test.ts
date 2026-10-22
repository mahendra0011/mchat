import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScopedMediaUrl, signMediaAccess, verifyScopedMediaAccess } from './signed-url.js';

test('scoped URL: valid signature verifies before expiry', () => {
  const scoped = createScopedMediaUrl('att_123', { ttlMs: 60_000 });
  const result = verifyScopedMediaAccess('att_123', scoped.path.match(/exp=(\d+)/)![1]!, scoped.token);
  assert.equal(result.valid, true);
});

test('scoped URL: tampered token is rejected', () => {
  const scoped = createScopedMediaUrl('att_123', { ttlMs: 60_000 });
  const exp = scoped.path.match(/exp=(\d+)/)![1]!;
  const tampered = `${scoped.token.slice(0, -2)}ff`;
  const result = verifyScopedMediaAccess('att_123', exp, tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');
});

test('scoped URL: signature does not transfer to a different attachment', () => {
  const scoped = createScopedMediaUrl('att_123', { ttlMs: 60_000 });
  const exp = scoped.path.match(/exp=(\d+)/)![1]!;
  const result = verifyScopedMediaAccess('att_OTHER', exp, scoped.token);
  assert.equal(result.valid, false, 'token must be bound to its attachment id');
});

test('scoped URL: expired signature is rejected', () => {
  const pastExp = Date.now() - 1000;
  const token = signMediaAccess('att_123', pastExp);
  const result = verifyScopedMediaAccess('att_123', String(pastExp), token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

test('scoped URL: missing params are rejected', () => {
  assert.equal(verifyScopedMediaAccess('att_123', undefined, 'sig').valid, false);
  assert.equal(verifyScopedMediaAccess('att_123', '123', undefined).valid, false);
  assert.equal(verifyScopedMediaAccess('att_123', 'not-a-number', 'sig').valid, false);
});

test('scoped URL: TTL is clamped between 1s and 1h', () => {
  const tiny = createScopedMediaUrl('a', { ttlMs: 5 });
  const tinyTtl = Number(tiny.path.match(/exp=(\d+)/)![1]!) - Date.now();
  assert.ok(tinyTtl >= 900, `min clamp got ${tinyTtl}`);

  const huge = createScopedMediaUrl('a', { ttlMs: 10 * 60 * 60 * 1000 });
  const hugeTtl = Number(huge.path.match(/exp=(\d+)/)![1]!) - Date.now();
  assert.ok(hugeTtl <= 60 * 60 * 1000 + 5000, `max clamp got ${hugeTtl}`);
});
