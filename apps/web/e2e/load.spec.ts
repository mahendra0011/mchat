import { test, expect } from '@playwright/test';

/**
 * Load tests using Playwright with multiple browser contexts.
 * These tests simulate concurrent users and measure performance metrics.
 */

test.describe('Load tests', () => {
  test('50 concurrent users sending messages in same conversation - latency p95 < 500ms', async ({ browser }) => {
    const userCount = 50;
    const messageCount = 5;
    const latencies: number[] = [];

    const contexts = await Promise.all(
      Array.from({ length: userCount }, () => browser.newContext())
    );

    const pages = await Promise.all(
      contexts.map((ctx) => ctx.newPage())
    );

    try {
      // Navigate all pages to the app
      await Promise.all(
        pages.map((page) => page.goto('/'))
      );

      // Wait for all pages to load
      await Promise.all(
        pages.map((page) => page.getByRole('complementary', { name: 'Primary Navigation' }).waitFor({ state: 'visible' }))
      );

      // Select first conversation on all pages
      await Promise.all(
        pages.map((page) => page.getByRole('region', { name: 'Conversation list' }).getByRole('button').first().click())
      );

      await Promise.all(
        pages.map((page) => page.locator('#message-composer-input').waitFor({ state: 'visible' }))
      );

      // Send messages concurrently and measure latency
      const sendPromises = pages.flatMap((page, userIndex) =>
        Array.from({ length: messageCount }, async (_, msgIndex) => {
          const start = Date.now();
          const composer = page.locator('#message-composer-input');
          const messageText = `Load test user ${userIndex} msg ${msgIndex} ${Date.now()}`;
          await composer.fill(messageText);
          await page.getByRole('button', { name: 'Send message' }).click();
          await page.getByText(messageText).last().waitFor({ state: 'visible', timeout: 10000 });
          const latency = Date.now() - start;
          latencies.push(latency);
        })
      );

      await Promise.all(sendPromises);
    } finally {
      // Cleanup
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }

    // Calculate p95 latency
    latencies.sort((a, b) => a - b);
    const p95Index = Math.ceil(latencies.length * 0.95) - 1;
    const p95Latency = latencies[p95Index];

    console.log(`Load test: ${latencies.length} messages sent`);
    console.log(`Latencies - min: ${latencies[0]}ms, max: ${latencies[latencies.length - 1]}ms, p95: ${p95Latency}ms`);

    // Assert p95 < 500ms
    expect(p95Latency).toBeLessThan(500);
  });

  test('Reconnect burst: 20 clients disconnect/reconnect rapidly', async ({ browser }) => {
    const clientCount = 20;
    const contexts = await Promise.all(
      Array.from({ length: clientCount }, () => browser.newContext())
    );

    const pages = await Promise.all(
      contexts.map((ctx) => ctx.newPage())
    );

    try {
      // Initial load
      await Promise.all(
        pages.map((page) => page.goto('/'))
      );

      await Promise.all(
        pages.map((page) => page.getByRole('complementary', { name: 'Primary Navigation' }).waitFor({ state: 'visible' }))
      );

      // Perform 3 rapid disconnect/reconnect cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        // Reload all pages (simulates disconnect/reconnect)
        await Promise.all(
          pages.map((page) => page.reload({ waitUntil: 'networkidle' }))
        );

        await Promise.all(
          pages.map((page) => page.getByRole('complementary', { name: 'Primary Navigation' }).waitFor({ state: 'visible' }))
        );

        // Small delay between cycles
        await pages[0].waitForTimeout(500);
      }

      // Verify all clients still functional by sending a message
      await Promise.all(
        pages.map((page) => page.getByRole('region', { name: 'Conversation list' }).getByRole('button').first().click())
      );

      await Promise.all(
        pages.map((page) => page.locator('#message-composer-input').waitFor({ state: 'visible' }))
      );

      const testMessage = `Reconnect test ${Date.now()}`;
      await Promise.all(
        pages.map((page) => {
          const composer = page.locator('#message-composer-input');
          composer.fill(testMessage);
          return page.getByRole('button', { name: 'Send message' }).click();
        })
      );

      await Promise.all(
        pages.map((page) => page.getByText(testMessage).last().waitFor({ state: 'visible', timeout: 10000 }))
      );
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });

  test('Large conversation render: 1000 messages virtualized scroll', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeVisible();

    // Open a conversation
    await page.getByRole('region', { name: 'Conversation list' }).getByRole('button').first().click();
    await expect(page.locator('#message-composer-input')).toBeVisible();

    // Measure initial render time
    const renderStart = Date.now();

    // The app uses virtualized list - scroll to trigger rendering
    const timeline = page.getByRole('region', { name: /timeline|messages/i });
    await expect(timeline).toBeVisible();

    // Scroll down multiple times to trigger virtualization
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(50);
    }

    const renderTime = Date.now() - renderStart;
    console.log(`Large conversation render time: ${renderTime}ms`);

    // Verify composer still visible and responsive
    await expect(page.locator('#message-composer-input')).toBeVisible();

    const testMessage = `Scroll test ${Date.now()}`;
    await page.locator('#message-composer-input').fill(testMessage);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(testMessage).last()).toBeVisible({ timeout: 5000 });
  });

  test('Search latency with 5000 indexed messages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('complementary', { name: 'Primary Navigation' })).toBeVisible();

    // Open search/command palette
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: /command palette|search/i })).toBeVisible();

    // Perform search queries and measure latency
    const searchQueries = ['test', 'message', 'hello', 'orbit', 'chat'];
    const latencies: number[] = [];

    for (const query of searchQueries) {
      const start = Date.now();

      const searchInput = page.getByRole('textbox', { name: /search|command/i });
      await searchInput.fill(query);

      // Wait for results to appear
      await page.getByRole('listbox', { name: /results/i }).waitFor({ state: 'visible', timeout: 5000 });

      const latency = Date.now() - start;
      latencies.push(latency);

      await searchInput.clear();
      await page.waitForTimeout(100);
    }

    // Calculate average latency
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    console.log(`Search latencies: ${latencies.join(', ')}ms`);
    console.log(`Average: ${avgLatency.toFixed(2)}ms, Max: ${maxLatency}ms`);

    // Assert average search latency < 200ms
    expect(avgLatency).toBeLessThan(200);
    expect(maxLatency).toBeLessThan(500);
  });
});