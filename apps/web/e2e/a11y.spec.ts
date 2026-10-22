import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function gotoApp(page: any) {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeVisible();
}

async function openSettingsModal(page: any) {
  await page.getByRole('button', { name: /settings/i }).click();
  await expect(page.getByRole('dialog', { name: 'Settings dialog' })).toBeVisible();
}

async function closeSettingsModal(page: any) {
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings dialog' })).toBeHidden();
}

async function openOnboardingModal(page: any) {
  await page.getByRole('button', { name: /onboarding|welcome/i }).click();
  await expect(page.getByRole('dialog', { name: /onboarding|welcome/i })).toBeVisible();
}

async function openNewConversationModal(page: any) {
  await page.getByRole('button', { name: /new conversation|compose/i }).click();
  await expect(page.getByRole('dialog', { name: /new conversation|compose/i })).toBeVisible();
}

async function openRightPanelTab(page: any, tabName: string) {
  await page.getByRole('button', { name: /details|timeline|privacy|vault|studio|cards/i }).first().click();
  await expect(page.getByRole('complementary', { name: 'Conversation details and tools' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(tabName, 'i') }).click();
}

test.describe('Accessibility (WCAG AA)', () => {
  test('Home/login page: no violations', async ({ page }) => {
    await gotoApp(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('Conversation list + canvas: no violations', async ({ page }) => {
    await gotoApp(page);
    const conversationList = page.getByRole('region', { name: 'Conversation list' });
    await conversationList.getByRole('button').first().click();
    await expect(page.locator('#message-composer-input')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('Settings modal (all 6 sections): no violations', async ({ page }) => {
    await gotoApp(page);
    await openSettingsModal(page);

    // Test each settings section for accessibility violations
    const categories = [
      'Account & Profile',
      'Privacy & Safety',
      'Security & Devices',
      'Appearance',
      'Notifications',
      'Chats & Messaging',
      'Business Settings',
      'Calls & Media',
      'Accessibility',
      'Language & Region',
      'Data & Storage',
      'Help & About',
    ];

    for (const category of categories) {
      await page.getByRole('button', { name: category }).click();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toHaveLength(0);
    }

    await closeSettingsModal(page);
  });

  test('Onboarding modal: no violations', async ({ page }) => {
    await gotoApp(page);
    await openOnboardingModal(page);

    // Step 1: Handle input
    let results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);

    // Step 2: Privacy preset selection
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.getByRole('radiogroup', { name: /privacy preset/i })).toBeVisible();
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);

    // Step 3: Completion screen
    await page.getByRole('radio', { name: /maximum privacy/i }).click();
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.getByText(/you are all set/i)).toBeVisible();
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('New conversation modal: no violations', async ({ page }) => {
    await gotoApp(page);
    await openNewConversationModal(page);

    // Test message mode
    let results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);

    // Test business mode
    await page.getByRole('button', { name: /create business/i }).click();
    await expect(page.getByLabel(/workspace name/i)).toBeVisible();
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);

    // Close modal
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('RightPanel (Details/Timeline/Vault/Privacy): no violations', async ({ page }) => {
    await gotoApp(page);
    const conversationList = page.getByRole('region', { name: 'Conversation list' });
    await conversationList.getByRole('button').first().click();
    await expect(page.locator('#message-composer-input')).toBeVisible();

    // Open right panel
    await page.getByRole('button', { name: /open details|details/i }).first().click();
    await expect(page.getByRole('complementary', { name: 'Conversation details and tools' })).toBeVisible();

    const tabs = ['Details', 'Timeline', 'Privacy', 'Vault', 'Studio', 'Cards'];
    for (const tab of tabs) {
      await page.getByRole('button', { name: tab }).click();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toHaveLength(0);
    }
  });
});