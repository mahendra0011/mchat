import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryLocalCache,
  createLocalCache,
  hasIndexedDb,
  type LocalCache,
} from './offline-cache.js';

async function exercise(cache: LocalCache): Promise<void> {
  assert.equal(await cache.get('missing'), undefined, 'unset key returns undefined');

  await cache.set('user:1', { id: '1', name: 'Ada' });
  assert.deepEqual(await cache.get('user:1'), { id: '1', name: 'Ada' });

  await cache.set('msgs:c1', [{ body: 'hello' }]);
  assert.deepEqual(await cache.get('msgs:c1'), [{ body: 'hello' }]);

  await cache.delete('user:1');
  assert.equal(await cache.get('user:1'), undefined, 'deleted key returns undefined');
}

test('memory cache: set/get/delete round-trip', async () => {
  await exercise(new MemoryLocalCache());
});

test('memory cache: keys() supports prefix filtering', async () => {
  const cache = new MemoryLocalCache();
  await cache.set('msgs:c1', []);
  await cache.set('msgs:c2', []);
  await cache.set('draft:c1', 'hi');

  assert.deepEqual((await cache.keys('msgs:')).sort(), ['msgs:c1', 'msgs:c2']);
  assert.deepEqual((await cache.keys('draft:')), ['draft:c1']);
  assert.equal((await cache.keys()).length, 3, 'no prefix lists everything');
});

test('memory cache: clear() removes all entries', async () => {
  const cache = new MemoryLocalCache();
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.clear();
  assert.equal((await cache.keys()).length, 0);
  assert.equal(await cache.get('a'), undefined);
});

test('memory cache: overwrites an existing key', async () => {
  const cache = new MemoryLocalCache();
  await cache.set('k', 'first');
  await cache.set('k', 'second');
  assert.equal(await cache.get('k'), 'second');
});

test('createLocalCache falls back to memory when IndexedDB is absent (Node)', async () => {
  assert.equal(hasIndexedDb(), false, 'Node test runtime has no indexedDB');
  const cache = createLocalCache();
  assert.ok(cache instanceof MemoryLocalCache, 'factory returns the memory backend in Node');
  await exercise(cache);
});
