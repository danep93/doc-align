import { defineConfig } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../extension/dist');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1, // Chrome extensions can't run in parallel
  globalSetup: './global-setup.ts',
  use: {
    headless: false, // Extensions require headed mode (use xvfb in CI)
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './playwright-report' }],
  ],
  projects: [
    {
      name: 'chrome-extension',
      use: {},
    },
  ],
});

export { EXTENSION_PATH };
