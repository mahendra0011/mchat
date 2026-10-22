import { defineConfig, devices } from '@playwright/test';

/**
 * Orbit web smoke E2E harness.
 * Starts the API (in-memory fixture store) and the Vite dev server, then runs
 * chromium-only smoke tests against http://localhost:5173.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Vite dev runs on 5173 for tests (CLI override of vite.config.ts port 3000,
    // which can collide with other local services such as Docker Desktop).
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @orbit/api build && pnpm --filter @orbit/api start',
      cwd: '../..',
      url: 'http://localhost:4000/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: '4000',
        AUTH_JWT_SECRET: 'e2e-only-jwt-secret-at-least-32-chars-long',
        SESSION_COOKIE_SECRET: 'e2e-only-cookie-secret-at-least-32-chars',
        API_BASE_URL: 'http://localhost:4000',
        WS_BASE_URL: 'ws://localhost:4000/v1/realtime',
        ENABLE_LOCAL_DEMO_FIXTURES: 'true',
        REDACT_SENSITIVE_LOGS: 'true',
      },
    },
    {
      command: 'pnpm --filter @orbit/web exec vite --port 5173 --strictPort',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
