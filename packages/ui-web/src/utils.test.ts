import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, hueFor } from './utils.js';

test('initials: two words take first letters of first and last', () => {
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('Grace Brewster Hopper'), 'GH');
});

test('initials: single word uses its first two letters', () => {
  assert.equal(initials('orbit'), 'OR');
  assert.equal(initials('Zed'), 'ZE');
});

test('initials: trims and collapses whitespace', () => {
  assert.equal(initials('  mary   jane  '), 'MJ');
});

test('initials: empty input falls back to a placeholder', () => {
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
});

test('hueFor: deterministic and within 0-359', () => {
  const a = hueFor('Alex Chen');
  const b = hueFor('Alex Chen');
  const c = hueFor('Maya Rao');
  assert.equal(a, b, 'same input -> same hue');
  assert.notEqual(a, c, 'different inputs usually differ');
  assert.ok(a >= 0 && a < 360, `hue in range: ${a}`);
});
