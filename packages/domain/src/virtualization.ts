/**
 * Lightweight list virtualization (Spec 10 — message virtualization for large histories).
 *
 * Renders only the rows intersecting the viewport (plus an overscan margin) instead
 * of the whole list, so a conversation with tens of thousands of messages stays smooth.
 *
 * This module is intentionally pure: it takes scroll position + geometry and returns
 * which slice to render. The UI layer supplies an estimated (or measured) row height
 * and re-renders on scroll. Uniform row heights keep the math exact and O(visible).
 */

export interface VirtualRow {
  index: number;
  /** Pixel offset of this row from the top of the full list. */
  top: number;
}

export interface VirtualWindow {
  /** First rendered row (inclusive), including overscan. */
  startIndex: number;
  /** One past the last rendered row (exclusive), including overscan. */
  endIndex: number;
  /** Total scrollable height of the full list. */
  totalHeight: number;
  /** Pixel offset of startIndex, used to translate the rendered slice. */
  offsetTop: number;
  visible: VirtualRow[];
}

export interface VirtualWindowOptions {
  itemCount: number;
  /** Estimated row height in px (uniform for exact windowing). */
  itemHeight: number;
  viewportHeight: number;
  scrollTop: number;
  /** Extra rows rendered above/below the viewport to hide scroll seams. */
  overscan?: number;
}

export function computeVirtualWindow(opts: VirtualWindowOptions): VirtualWindow {
  const { itemCount, itemHeight, viewportHeight } = opts;
  const empty: VirtualWindow = { startIndex: 0, endIndex: 0, totalHeight: 0, offsetTop: 0, visible: [] };
  if (itemCount <= 0 || itemHeight <= 0) return empty;

  const overscan = Math.max(0, opts.overscan ?? 4);
  const totalHeight = itemCount * itemHeight;
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const scrollTop = Math.max(0, Math.min(opts.scrollTop, maxScroll));

  const firstVisible = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + 1;
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(itemCount, firstVisible + visibleCount + overscan);
  const offsetTop = startIndex * itemHeight;

  const visible: VirtualRow[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    visible.push({ index: i, top: i * itemHeight });
  }

  return { startIndex, endIndex, totalHeight, offsetTop, visible };
}
