import {defineConfig, devices} from '@playwright/test';

/**
 * End-to-end tests against the production build (`vite preview`), the local
 * Supabase stack and the Edge Functions (`pnpm functions:serve`), with the
 * controlled LiqPay / Nova Poshta adapters (`pnpm fakes`). See SETUP.md.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  globalSetup: './tests/e2e/global-setup.ts',
  expect: {timeout: 15_000},
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : [['list']],
  use: {baseURL: 'http://localhost:4180', trace: 'retain-on-failure', locale: 'uk-UA', timezoneId: 'Europe/Kyiv'},
  webServer: [
    {command: 'pnpm preview', url: 'http://localhost:4180', reuseExistingServer: true, timeout: 60_000},
    {command: 'pnpm fakes', url: 'http://127.0.0.1:55481/v2.0/json/', reuseExistingServer: true, timeout: 30_000, ignoreHTTPSErrors: true},
  ],
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 900}}, testIgnore: /mobile\.spec/},
    {name: 'phone', use: {...devices['Pixel 7']}, testMatch: /mobile\.spec/},
  ],
});
