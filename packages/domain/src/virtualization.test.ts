import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVirtualWindow } from './virtualization.js';

test('empty list yields an empty window', () => {
  const w = computeVirtualWindow({ itemCount: 0, itemHeight: 40, viewportHeight: 400, scrollTop: 0 });
  assert.equal(w.totalHeight, 0);
  assert.equal(w.visible.length, 0);
  assert.equal(w.startIndex, 0);
  assert.equal(w.endIndex, 0);
});

test('renders only a small slice, not the whole list', () => {
  const w = computeVirtualWindow({ itemCount: 1000, itemHeight: 40, viewportHeight: 400, scrollTop: 0 });
  assert.equal(w.totalHeight, 40000);
  assert.ok(w.visible.length < 30, `expected a small slice, got ${w.visible.length}`);
  assert.equal(w.startIndex, 0);
});

test('window follows scrollTop', () => {
  const opts = { itemCount: 1000, itemHeight: 40, viewportHeight: 400, overscan: 0 };
  const top = computeVirtualWindow({ ...opts, scrollTop: 0 });
  const mid = computeVirtualWindow({ ...opts, scrollTop: 4000 }); // row 100
  assert.equal(mid.startIndex, 100);
  assert.ok(mid.startIndex > top.startIndex, 'scrolling moves the window down');
  assert.ok(mid.endIndex > mid.startIndex);
});

test('overscan extends rows above and below the viewport', () => {
  const base = computeVirtualWindow({ itemCount: 1000, itemHeight: 40, viewportHeight: 400, scrollTop: 4000, overscan: 0 });
  const over = computeVirtualWindow({ itemCount: 1000, itemHeight: 40, viewportHeight: 400, scrollTop: 4000, overscan: 5 });
  assert.equal(over.startIndex, base.startIndex - 5);
  assert.equal(over.endIndex, base.endIndex + 5);
  assert.equal(over.offsetTop, over.startIndex * 40);
});

test('scrolling past the end clamps to the last rows', () => {
  const w = computeVirtualWindow({ itemCount: 10, itemHeight: 40, viewportHeight: 400, scrollTop: 999999, overscan: 0 });
  assert.equal(w.endIndex, 10, 'endIndex never exceeds itemCount');
  assert.ok(w.startIndex < 10);
  assert.ok(w.visible.every((r) => r.top < w.totalHeight));
});

test('rows are contiguous and offsets are exact', () => {
  const w = computeVirtualWindow({ itemCount: 500, itemHeight: 24, viewportHeight: 300, scrollTop: 1200 });
  for (let i = 1; i < w.visible.length; i++) {
    const prev = w.visible[i - 1]!;
    const cur = w.visible[i]!;
    assert.equal(cur.index, prev.index + 1, 'indices are contiguous');
    assert.equal(cur.top, prev.top + 24, 'tops advance by itemHeight');
  }
  assert.equal(w.totalHeight, 500 * 24);
});

test('near the top, startIndex does not go negative', () => {
  const w = computeVirtualWindow({ itemCount: 100, itemHeight: 40, viewportHeight: 400, scrollTop: 10, overscan: 10 });
  assert.equal(w.startIndex, 0);
});
