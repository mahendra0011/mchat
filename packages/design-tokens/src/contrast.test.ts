import { describe, it } from 'node:test';
import assert from 'node:assert';
import { colors, spacing, radii, motion } from './tokens.js';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe('Spec 05 — WCAG contrast validation', () => {
  const lightPairs: [string, string, string, string, number][] = [
    ['textPrimary', 'canvas', colors.light.textPrimary, colors.light.canvas, 4.5],
    ['textPrimary', 'surface', colors.light.textPrimary, colors.light.surface, 4.5],
    ['textSecondary', 'canvas', colors.light.textSecondary, colors.light.canvas, 4.5],
    ['textSecondary', 'surface', colors.light.textSecondary, colors.light.surface, 4.5],
    ['accentText', 'accentPrimary', colors.light.accentText, colors.light.accentPrimary, 4.5],
    ['positive', 'surface', colors.light.positive, colors.light.surface, 4.5],
    ['danger', 'surface', colors.light.danger, colors.light.surface, 4.5],
    ['caution', 'surface', colors.light.caution, colors.light.surface, 4.5],
  ];

  for (const [fgName, bgName, fg, bg, minRatio] of lightPairs) {
    it(`light: ${fgName} on ${bgName} meets WCAG AA (${minRatio}:1)`, () => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(
        ratio >= minRatio,
        `${fgName} on ${bgName}: ratio ${ratio.toFixed(2)} < ${minRatio}`
      );
    });
  }

  const darkPairs: [string, string, string, string, number][] = [
    ['textPrimary', 'canvas', colors.dark.textPrimary, colors.dark.canvas, 4.5],
    ['textPrimary', 'surface', colors.dark.textPrimary, colors.dark.surface, 4.5],
    ['textSecondary', 'canvas', colors.dark.textSecondary, colors.dark.canvas, 4.5],
    ['textSecondary', 'surface', colors.dark.textSecondary, colors.dark.surface, 4.5],
    ['accentText', 'accentPrimary', colors.dark.accentText, colors.dark.accentPrimary, 4.5],
    ['positive', 'surface', colors.dark.positive, colors.dark.surface, 4.5],
    ['danger', 'surface', colors.dark.danger, colors.dark.surface, 4.5],
    ['caution', 'surface', colors.dark.caution, colors.dark.surface, 4.5],
  ];

  for (const [fgName, bgName, fg, bg, minRatio] of darkPairs) {
    it(`dark: ${fgName} on ${bgName} meets WCAG AA (${minRatio}:1)`, () => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(
        ratio >= minRatio,
        `${fgName} on ${bgName}: ratio ${ratio.toFixed(2)} < ${minRatio}`
      );
    });
  }

  it('focus ring meets 3:1 non-text contrast against canvas', () => {
    assert.ok(contrastRatio(colors.light.focusRing, colors.light.canvas) >= 3);
    assert.ok(contrastRatio(colors.dark.focusRing, colors.dark.canvas) >= 3);
  });

  it('positive/negative surface tints stay readable', () => {
    assert.ok(contrastRatio(colors.light.textPrimary, colors.light.positiveSoft) >= 4.5);
    assert.ok(contrastRatio(colors.light.textPrimary, colors.light.dangerSoft) >= 4.5);
    assert.ok(contrastRatio(colors.dark.textPrimary, colors.dark.positiveSoft) >= 4.5);
    assert.ok(contrastRatio(colors.dark.textPrimary, colors.dark.dangerSoft) >= 4.5);
  });
});

describe('Spec 05 — Spacing & radius scale', () => {
  it('spacing follows 4/8/12/16/20/24/32/40/48/64 scale', () => {
    const expected = ['0px', '4px', '8px', '12px', '16px', '20px', '24px', '32px', '40px', '48px', '64px'];
    const actual = Object.values(spacing);
    assert.deepStrictEqual(actual, expected);
  });

  it('radius scale matches spec (8/12/16/20/full)', () => {
    assert.strictEqual(radii.sm, '8px');
    assert.strictEqual(radii.md, '12px');
    assert.strictEqual(radii.lg, '16px');
    assert.strictEqual(radii.xl, '20px');
    assert.strictEqual(radii.full, '9999px');
  });
});

describe('Spec 06 — Motion tokens', () => {
  it('durations are within spec ranges (100–300ms)', () => {
    const durations = Object.values(motion.duration).map((d) => parseInt(d));
    for (const d of durations) {
      assert.ok(d >= 100 && d <= 300, `duration ${d}ms outside 100–300ms range`);
    }
  });

  it('easing tokens defined for enter/exit/standard', () => {
    assert.ok(motion.easing.enter.length > 0);
    assert.ok(motion.easing.exit.length > 0);
    assert.ok(motion.easing.standard.length > 0);
  });
});
