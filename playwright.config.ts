import {defineConfig, devices} from '@playwright/test';

/**
 * End-to-end tests against the production build (`vite preview`) and the
 * local Supabase stack (`pnpm db:start`, `pnpm functions:serve`).
 */
// E2E_BASE_URL=https://… runs the public checks against a deployed site.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const local = /localhost|127\.0\.0\.1/.test(baseURL);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  globalSetup: local ? './tests/e2e/global-setup.ts' : undefined,
  expect: {timeout: 15_000},
  fullyParallel: false,
  // Tests share one studio's free slots: two parallel bookers would race for the same slot.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {baseURL, trace: 'retain-on-failure', locale: 'ru-RU', timezoneId: 'Europe/Moscow'},
  webServer: local ? {command: 'pnpm preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000} : undefined,
  projects: [
    {name: 'phone', use: {...devices['Pixel 7']}},
    {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1366, height: 900}}},
  ],
});
