import { test, expect, Page } from '@playwright/test';

/**
 * Orbit web smoke tests.
 *
 * The app auto-establishes a demo session (seeded fixture account — there is no
 * login screen in the local demo build), loads the conversation list, and the
 * active conversation's composer. Selectors rely on stable aria-labels and the
 * composer textarea id from the app source.
 */

async function gotoApp(page: Page) {
  await page.goto('/');
  // Left rail is the app shell marker.
  await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeVisible();
}

test('app loads and shows the main UI with a conversation list', async ({ page }) => {
  await gotoApp(page);

  const conversationList = page.getByRole('region', { name: 'Conversation list' });
  await expect(conversationList).toBeVisible();

  // Seeded fixtures include at least the "Maya Chen" direct conversation.
  await expect(conversationList.getByRole('button').first()).toBeVisible();
});

test('can open a conversation and see the composer', async ({ page }) => {
  await gotoApp(page);

  const conversationList = page.getByRole('region', { name: 'Conversation list' });
  const firstConversation = conversationList.getByRole('button').first();
  await firstConversation.click();

  // Composer is the timeline footer marker.
  const composer = page.locator('#message-composer-input');
  await expect(composer).toBeVisible();
});

test('can send a message', async ({ page }) => {
  await gotoApp(page);

  // Ensure a conversation is active (fixture default already selects one, but
  // click explicitly to be resilient).
  const conversationList = page.getByRole('region', { name: 'Conversation list' });
  await conversationList.getByRole('button').first().click();

  const composer = page.locator('#message-composer-input');
  await expect(composer).toBeVisible();

  const messageText = `E2E smoke message ${Date.now()}`;
  await composer.fill(messageText);
  await page.getByRole('button', { name: 'Send message' }).click();

  // Optimistic UI renders the sent bubble in the timeline.
  await expect(page.getByText(messageText).last()).toBeVisible();
});
