import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRedisClient, setRedis, getRedis } from './redis.js';
import { JobQueue } from './job-queue.js';
import { TelemetryRecorder } from './telemetry.js';

// ---- Redis abstraction ----

test('redis: get/set/del/exists and TTL expiry', async () => {
  const redis = new InMemoryRedisClient();
  assert.equal(await redis.ping(), 'PONG');

  await redis.set('k', 'v');
  assert.equal(await redis.get('k'), 'v');
  assert.equal(await redis.exists('k'), true);

  await redis.set('temp', 'gone', 1); // 1ms TTL
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await redis.get('temp'), null, 'expired key must be gone');
  assert.equal(await redis.exists('temp'), false);

  await redis.del('k');
  assert.equal(await redis.get('k'), null);
});

test('redis: list queue primitives and incr', async () => {
  const redis = new InMemoryRedisClient();
  assert.equal(await redis.llen('q'), 0);
  await redis.rpush('q', 'a');
  await redis.rpush('q', 'b');
  assert.equal(await redis.llen('q'), 2);
  assert.equal(await redis.lpop('q'), 'a');
  assert.equal(await redis.lpop('q'), 'b');
  assert.equal(await redis.lpop('q'), null);

  assert.equal(await redis.incr('hits', 60_000), 1);
  assert.equal(await redis.incr('hits', 60_000), 2);
  assert.equal(await redis.get('hits'), '2');
});

test('redis: setRedis swaps the process-wide client', async () => {
  const custom = new InMemoryRedisClient();
  setRedis(custom);
  await getRedis().set('probe', 'yes');
  assert.equal(await custom.get('probe'), 'yes');
  setRedis(new InMemoryRedisClient()); // restore
});

// ---- Durable job queue ----

test('job queue: enqueue and process a job', async () => {
  const queue = new JobQueue(new InMemoryRedisClient());
  let ran = 0;
  await queue.enqueue('demo', { n: 1 });
  assert.equal(await queue.size(), 1);

  const processed = await queue.runOnce({
    demo: async () => {
      ran++;
    },
  });
  assert.equal(processed, 1);
  assert.equal(ran, 1);
  assert.equal(await queue.size(), 0);
});

test('job queue: failing job retries then dead-letters at max attempts', async () => {
  const queue = new JobQueue(new InMemoryRedisClient());
  await queue.enqueue('boom', {}, { maxAttempts: 1 }); // fail once -> dead letter

  const processed = await queue.runOnce({
    boom: async () => {
      throw new Error('always fails');
    },
  });
  assert.equal(processed, 1);
  assert.equal(await queue.size(), 0, 'queue drained');
  assert.equal(await queue.deadCount(), 1, 'job moved to dead-letter');
});

test('job queue: retry requeues with backoff when attempts remain', async () => {
  const queue = new JobQueue(new InMemoryRedisClient());
  await queue.enqueue('flaky', {}, { maxAttempts: 3 });

  const processed = await queue.runOnce({
    flaky: async () => {
      throw new Error('first failure');
    },
  });
  assert.equal(processed, 1);
  assert.equal(await queue.size(), 1, 'retried job requeued');
  assert.equal(await queue.deadCount(), 0, 'not dead-lettered yet');

  // The retry is scheduled in the future (backoff), so an immediate pass
  // must not run it again.
  const secondPass = await queue.runOnce({
    flaky: async () => {
      throw new Error('should not run yet');
    },
  });
  assert.equal(secondPass, 0, 'backoff prevents immediate rerun');
});

test('job queue: delayed job is not run before it is due', async () => {
  const queue = new JobQueue(new InMemoryRedisClient());
  await queue.enqueue('later', {}, { delayMs: 60_000 });
  const processed = await queue.runOnce({ later: async () => {} });
  assert.equal(processed, 0, 'future job skipped');
  assert.equal(await queue.size(), 1, 'still queued');
});

// ---- Telemetry (OTel-style) ----

test('telemetry: success span, error span, counter, histogram', async () => {
  const tel = new TelemetryRecorder();

  await tel.startSpan('ok-op', async () => 'done', { kind: 'test' });
  assert.equal(tel.getSpanCount(), 1);
  const ok = tel.getSpans('ok-op')[0]!;
  assert.equal(ok.status, 'ok');

  await assert.rejects(
    () => tel.startSpan('bad-op', async () => {
      throw new Error('nope');
    }),
    /nope/
  );
  const bad = tel.getSpans('bad-op')[0]!;
  assert.equal(bad.status, 'error');
  assert.equal(bad.errorMessage, 'nope');

  tel.counter('events').add(3);
  tel.counter('events').add(2);
  assert.equal(tel.getCounter('events'), 5);

  tel.histogram('latency').record(10);
  tel.histogram('latency').record(30);
  assert.deepEqual(tel.getHistogram('latency'), [10, 30]);
});
