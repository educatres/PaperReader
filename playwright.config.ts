import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.ts', timeout: 60000, fullyParallel: false,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: process.env.TEST_BASE_URL ? undefined : { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
