import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildE2eeIndex,
  addE2eeMessage,
  removeE2eeMessage,
  searchE2eeIndex,
  extractSnippet,
  tokenize,
  type E2eeIndexMessage,
} from './e2ee-search.js';

const now = Date.UTC(2026, 0, 15);

function msg(overrides: Partial<E2eeIndexMessage> & { id: string; text: string }): E2eeIndexMessage {
  return {
    conversationId: 'conv_a',
    senderWorkspaceId: 'ws_1',
    sentAt: now,
    ...overrides,
  };
}

test('tokenize lowercases, drops stopwords and single characters', () => {
  assert.deepEqual(tokenize('The Quick brown Fox!'), ['quick', 'brown', 'fox']);
  assert.deepEqual(tokenize('a I to of the 9 x'), [], 'single-char and stopword tokens are dropped');
});

test('search: AND semantics require every query token', () => {
  const index = buildE2eeIndex([
    msg({ id: 'm1', text: 'deploy the release to staging today' }),
    msg({ id: 'm2', text: 'release notes are ready for review' }),
    msg({ id: 'm3', text: 'staging environment is green' }),
  ]);

  const andHits = searchE2eeIndex(index, 'release staging');
  assert.equal(andHits.length, 1, 'only m1 contains both tokens');
  assert.equal(andHits[0]!.id, 'm1');

  const orCheck = searchE2eeIndex(index, 'release');
  assert.equal(orCheck.length, 2, 'single token matches m1 and m2');
});

test('search: filters by conversation and sender', () => {
  const index = buildE2eeIndex([
    msg({ id: 'm1', conversationId: 'conv_a', text: 'alpha shared here' }),
    msg({ id: 'm2', conversationId: 'conv_b', text: 'alpha shared there' }),
    msg({ id: 'm3', conversationId: 'conv_a', senderWorkspaceId: 'ws_2', text: 'alpha from other' }),
  ]);

  assert.deepEqual(
    searchE2eeIndex(index, 'alpha', { conversationId: 'conv_b' }).map((h) => h.id),
    ['m2']
  );
  assert.deepEqual(
    searchE2eeIndex(index, 'alpha', { senderWorkspaceId: 'ws_2' }).map((h) => h.id),
    ['m3']
  );
});

test('search: no match when a query token appears nowhere', () => {
  const index = buildE2eeIndex([msg({ id: 'm1', text: 'hello world' })]);
  assert.equal(searchE2eeIndex(index, 'hello missingword').length, 0);
});

test('search: empty or stopword-only query returns nothing', () => {
  const index = buildE2eeIndex([msg({ id: 'm1', text: 'hello world' })]);
  assert.equal(searchE2eeIndex(index, '').length, 0);
  assert.equal(searchE2eeIndex(index, 'the of and').length, 0);
});

test('search: ranked by term frequency then recency, respects limit', () => {
  const index = buildE2eeIndex([
    msg({ id: 'old', text: 'bug fix', sentAt: now - 400 * 86_400_000 }),
    msg({ id: 'new', text: 'bug fix', sentAt: now }),
    msg({ id: 'rich', text: 'bug bug bug reported', sentAt: now - 86_400_000 }),
  ]);

  const hits = searchE2eeIndex(index, 'bug');
  assert.equal(hits[0]!.id, 'rich', 'highest tf wins');
  const ids = hits.map((h) => h.id);
  assert.ok(ids.indexOf('new') < ids.indexOf('old'), 'newer ranks above older at equal tf');

  assert.equal(searchE2eeIndex(index, 'bug', { limit: 1 }).length, 1);
});

test('search: sinceSentAt filters older messages', () => {
  const index = buildE2eeIndex([
    msg({ id: 'old', text: 'deploy', sentAt: now - 10 * 86_400_000 }),
    msg({ id: 'recent', text: 'deploy', sentAt: now }),
  ]);
  const hits = searchE2eeIndex(index, 'deploy', { sinceSentAt: now - 86_400_000 });
  assert.deepEqual(hits.map((h) => h.id), ['recent']);
});

test('incremental add and remove update postings correctly', () => {
  const index = buildE2eeIndex([msg({ id: 'm1', text: 'exclusive token' })]);
  assert.equal(searchE2eeIndex(index, 'exclusive').length, 1);

  removeE2eeMessage(index, 'm1');
  assert.equal(searchE2eeIndex(index, 'exclusive').length, 0);
  assert.equal(index.messages.size, 0);

  addE2eeMessage(index, msg({ id: 'm2', text: 'fresh token' }));
  assert.equal(searchE2eeIndex(index, 'token').length, 1);
  assert.equal(searchE2eeIndex(index, 'exclusive').length, 0);
});

test('extractSnippet centers on the match and marks truncation', () => {
  const text = 'lorem ipsum '.repeat(20) + 'special keyword here' + ' dolor sit'.repeat(20);
  const snippet = extractSnippet(text, 'keyword', 60);
  assert.ok(snippet.includes('keyword'));
  assert.ok(snippet.startsWith('…'), 'leading ellipsis when trimmed');
  assert.ok(snippet.length <= 64, `snippet kept short: ${snippet.length}`);
});

test('extractSnippet returns the head when nothing matches', () => {
  assert.equal(extractSnippet('plain text here', 'nomatch', 10), 'plain text');
});
