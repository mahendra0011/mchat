import { describe, it } from 'node:test';
import assert from 'node:assert';
import { I18nManager } from './formatter.js';

describe('I18nManager', () => {
  it('defaults to English and allows switching to Spanish', () => {
    const manager = new I18nManager();
    assert.strictEqual(manager.getLocale(), 'en');
    assert.strictEqual(manager.t().common.business, 'Business');

    manager.setLocale('es');
    assert.strictEqual(manager.getLocale(), 'es');
    assert.strictEqual(manager.t().common.business, 'Empresa');
  });

  it('formats dates and timestamps consistently', () => {
    const manager = new I18nManager();
    const testDate = new Date('2026-05-15T14:30:00Z').toISOString();

    const formattedTime = manager.formatTimestamp(testDate, { timeZone: 'UTC' });
    assert.ok(formattedTime.includes('14') || formattedTime.includes('2:30'));

    const formattedDate = manager.formatDate(testDate);
    assert.ok(formattedDate.includes('2026'));
  });

  it('detects RTL languages and formats numbers and currency', () => {
    const manager = new I18nManager();
    assert.strictEqual(manager.isRTL('en'), false);
    assert.strictEqual(manager.isRTL('es'), false);
    assert.strictEqual(manager.isRTL('ar'), true);
    assert.strictEqual(manager.isRTL('he'), true);
    assert.strictEqual(manager.isRTL('fa'), true);
    assert.strictEqual(manager.isRTL('ur'), true);

    const numStr = manager.formatNumber(1250500);
    assert.ok(numStr.includes('1,250,500') || numStr.includes('1.250.500'));

    const currStr = manager.formatCurrency(49.99, 'USD');
    assert.ok(currStr.includes('49.99') || currStr.includes('49,99'));
    assert.ok(currStr.includes('$') || currStr.includes('USD'));
  });
});
