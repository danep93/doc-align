import { defineConfig } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../extension/dist');

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 0,
  workers: 1, // Chrome extensions can't run in parallel
  use: {
    headless: false, // Extensions require headed mode
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chrome-extension',
      use: {
        // Playwright will use the custom fixture that launches with extension
      },
    },
  ],
});

export { EXTENSION_PATH };
