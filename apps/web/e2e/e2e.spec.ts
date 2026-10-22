import { test, expect, Page } from '@playwright/test';

async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeVisible();
}

async function openSettingsModal(page: Page) {
  await page.getByRole('button', { name: /settings/i }).click();
  await expect(page.getByRole('dialog', { name: 'Settings dialog' })).toBeVisible();
}

async function closeSettingsModal(page: Page) {
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings dialog' })).toBeHidden();
}

async function openOnboardingModal(page: Page) {
  await page.getByRole('button', { name: /onboarding|welcome/i }).click();
  await expect(page.getByRole('dialog', { name: /onboarding|welcome/i })).toBeVisible();
}

async function openNewConversationModal(page: Page) {
  await page.getByRole('button', { name: /new conversation|compose/i }).click();
  await expect(page.getByRole('dialog', { name: /new conversation|compose/i })).toBeVisible();
}

async function openSessionsModal(page: Page) {
  await openSettingsModal(page);
  await page.getByRole('button', { name: /security & devices/i }).click();
  await page.getByRole('button', { name: /active sessions/i }).click();
  await expect(page.getByRole('dialog', { name: /sessions|devices/i })).toBeVisible();
}

async function openRightPanelTab(page: Page, tabName: string) {
  await page.getByRole('button', { name: /details|timeline|privacy|vault|studio|cards/i }).first().click();
  await expect(page.getByRole('complementary', { name: 'Conversation details and tools' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(tabName, 'i') }).click();
}

async function selectWorkspace(page: Page, workspaceName: string) {
  await page.getByRole('button', { name: new RegExp(workspaceName, 'i') }).click();
}

async function sendMessage(page: Page, text: string) {
  const composer = page.locator('#message-composer-input');
  await composer.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(text).last()).toBeVisible();
}

test.describe('High-value E2E paths', () => {
  test('1. Onboarding flow completion', async ({ page }) => {
    await gotoApp(page);
    await openOnboardingModal(page);

    // Step 1: Enter handle
    await page.getByPlaceholder('username').fill('e2etestuser');
    await page.getByRole('button', { name: /next/i }).click();

    // Step 2: Select privacy preset (Maximum Privacy)
    await expect(page.getByRole('radiogroup', { name: /privacy preset/i })).toBeVisible();
    await page.getByRole('radio', { name: /maximum privacy/i }).click();
    await page.getByRole('button', { name: /next/i }).click();

    // Step 3: Completion screen
    await expect(page.getByText(/you are all set/i)).toBeVisible();
    await expect(page.getByText(/e2etestuser/i)).toBeVisible();
    await expect(page.getByText(/Maximum Privacy/i)).toBeVisible();

    await page.getByRole('button', { name: /start messaging/i }).click();
    await expect(page.getByRole('dialog', { name: /onboarding|welcome/i })).toBeHidden();
  });

  test('2. Device session revocation', async ({ page }) => {
    await gotoApp(page);
    await openSessionsModal(page);

    // Wait for sessions list to load
    await expect(page.getByRole('list', { name: /active sessions|devices/i })).toBeVisible();

    // Find a session to revoke (not the current one)
    const revokeButtons = page.getByRole('button', { name: /revoke|sign out/i });
    const count = await revokeButtons.count();

    if (count > 1) {
      // Click the second revoke button (first is usually current session)
      await revokeButtons.nth(1).click();

      // Confirm revocation if dialog appears
      const confirmButton = page.getByRole('button', { name: /confirm|revoke|yes/i });
      if (await confirmButton.isVisible({ timeout: 1000 })) {
        await confirmButton.click();
      }

      // Verify session was removed
      await expect(revokeButtons).toHaveCount(count - 1);
    }
  });

  test('3. Identity/workspace switching', async ({ page }) => {
    await gotoApp(page);

    // Get initial workspace name
    const initialWorkspace = await page.getByRole('complementary', { name: 'Primary Navigation' }).textContent();

    // Click on a different workspace in the left rail
    const workspaceButtons = page.getByRole('button', { name: /workspace|alex|maya|business/i });
    const count = await workspaceButtons.count();

    if (count > 1) {
      // Click the second workspace
      await workspaceButtons.nth(1).click();

      // Verify workspace switched (conversation list should update)
      await expect(page.getByRole('region', { name: 'Conversation list' })).toBeVisible();

      // Check for screen reader announcement
      await expect(page.getByRole('status', { name: /switched to/i })).toBeVisible({ timeout: 2000 });
    }
  });

  test('4. Business internal notes', async ({ page }) => {
    await gotoApp(page);

    // Switch to business workspace if available
    const businessWorkspace = page.getByRole('button', { name: /business/i });
    if (await businessWorkspace.isVisible({ timeout: 1000 })) {
      await businessWorkspace.click();
    }

    // Select a business conversation
    const conversationList = page.getByRole('region', { name: 'Conversation list' });
    await conversationList.getByRole('button').first().click();

    // Open right panel and go to Details to check for internal note toggle
    await page.getByRole('button', { name: /details/i }).first().click();
    await expect(page.getByRole('complementary', { name: 'Conversation details and tools' })).toBeVisible();

    // Look for internal notes toggle or button in conversation canvas
    const internalNoteToggle = page.getByRole('button', { name: /internal note|toggle internal/i });
    if (await internalNoteToggle.isVisible({ timeout: 2000 })) {
      await internalNoteToggle.click();

      // Send an internal note
      const composer = page.locator('#message-composer-input');
      await composer.fill('Internal note for team');
      await page.getByRole('button', { name: 'Send internal note' }).click();

      // Verify internal note label appears
      await expect(page.getByText(/internal note/i)).toBeVisible();
    }
  });

  test('5. Export flow', async ({ page }) => {
    await gotoApp(page);
    await openSettingsModal(page);

    // Navigate to Data & Storage
    await page.getByRole('button', { name: /data & storage/i }).click();

    // Click export button
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export/i }).click();
    const download = await downloadPromise;

    // Verify download
    expect(download.suggestedFilename()).toMatch(/orbit-chat-export.*\.json/);

    await closeSettingsModal(page);
  });

  test('6. Account deletion request', async ({ page }) => {
    await gotoApp(page);
    await openSettingsModal(page);

    // Navigate to Account & Profile
    await page.getByRole('button', { name: /account & profile/i }).click();

    // Click delete account button
    await page.getByRole('button', { name: /delete account/i }).click();

    // Should show step-up confirmation dialog
    await expect(page.getByRole('dialog', { name: /delete account|confirm deletion/i })).toBeVisible();

    // Verify step-up authentication is required
    await expect(page.getByLabel(/password|confirm/i)).toBeVisible();

    // Cancel within grace period
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog', { name: /delete account|confirm deletion/i })).toBeHidden();

    await closeSettingsModal(page);
  });

  test('7. Cross-platform simulation (web-only paths)', async ({ page }) => {
    await gotoApp(page);

    // Test keyboard navigation
    await page.keyboard.press('Tab');
    await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeFocused();

    // Test command palette
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // Test theme toggle
    await page.getByRole('button', { name: /theme|dark|light/i }).first().click();
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(['light', 'dark']).toContain(theme);

    // Toggle back
    await page.getByRole('button', { name: /theme|dark|light/i }).first().click();

    // Test responsive layout (resize viewport)
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});