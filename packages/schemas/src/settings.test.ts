import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateSettingsUpdate,
  isSettingsSection,
  SECTION_SCOPES,
  SECTION_SCHEMAS,
  ALL_SETTINGS_SECTIONS,
  AppearanceSettingsSchema,
  PrivacySettingsSchema,
} from './settings.js';

describe('Spec 09 — Settings validation', () => {
  it('all sections A–L (mapped subset) are recognized', () => {
    for (const s of ALL_SETTINGS_SECTIONS) {
      assert.ok(isSettingsSection(s));
    }
    assert.ok(!isSettingsSection('nonexistent'));
  });

  it('every section has a declared scope', () => {
    for (const s of ALL_SETTINGS_SECTIONS) {
      assert.ok(SECTION_SCOPES[s], `Missing scope for ${s}`);
      assert.ok(SECTION_SCHEMAS[s], `Missing schema for ${s}`);
    }
  });

  it('privacy is identity-scoped, notifications device-scoped', () => {
    assert.strictEqual(SECTION_SCOPES.privacy, 'identity');
    assert.strictEqual(SECTION_SCOPES.notifications, 'device');
    assert.strictEqual(SECTION_SCOPES.appearance, 'account');
  });

  it('appearance accepts valid update with defaults', () => {
    const result = validateSettingsUpdate('appearance', { theme: 'dark' });
    assert.ok(result.ok);
    if (result.ok) {
      const data = result.data as { theme: string; density: string };
      assert.strictEqual(data.theme, 'dark');
      assert.strictEqual(data.density, 'standard'); // default applied
    }
  });

  it('appearance rejects invalid theme', () => {
    const result = validateSettingsUpdate('appearance', { theme: 'neon' });
    assert.ok(!result.ok);
  });

  it('privacy rejects invalid visibility enum', () => {
    const result = validateSettingsUpdate('privacy', { lastActiveVisibility: 'aliens' });
    assert.ok(!result.ok);
  });

  it('privacy accepts valid update', () => {
    const result = validateSettingsUpdate('privacy', { readReceipts: false, lastActiveVisibility: 'nobody' });
    assert.ok(result.ok);
  });

  it('unknown section rejected', () => {
    const result = validateSettingsUpdate('bogus', {});
    assert.ok(!result.ok);
  });

  it('notifications quiet hours use HH:MM format', () => {
    const okResult = validateSettingsUpdate('notifications', { quietHoursStart: '22:00', quietHoursEnd: '07:00' });
    assert.ok(okResult.ok);
    const badResult = validateSettingsUpdate('notifications', { quietHoursStart: '10pm' });
    assert.ok(!badResult.ok);
  });

  it('accessibility textScaling bounded 0.5–3', () => {
    const okResult = validateSettingsUpdate('accessibility', { textScaling: 1.5 });
    assert.ok(okResult.ok);
    const badResult = validateSettingsUpdate('accessibility', { textScaling: 10 });
    assert.ok(!badResult.ok);
  });

  it('AppearanceSettingsSchema defaults are spec-compliant', () => {
    const parsed = AppearanceSettingsSchema.parse({});
    assert.strictEqual(parsed.theme, 'system');
    assert.strictEqual(parsed.density, 'standard');
    assert.strictEqual(parsed.reduceMotion, false);
  });

  it('PrivacySettingsSchema defaults hide notification previews', () => {
    const parsed = PrivacySettingsSchema.parse({});
    assert.strictEqual(parsed.hideNotificationPreviews, true);
    assert.strictEqual(parsed.readReceipts, true);
  });
});
