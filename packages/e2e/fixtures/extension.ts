import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const AUTH_STATE_DIR = path.resolve(__dirname, '../.auth-state');

// Use the real Chrome installation — detect platform for CI compatibility
function getDefaultChromePath(): string {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'linux') {
    // Playwright's installed Chromium location
    return chromium.executablePath();
  }
  return 'chrome';
}
const CHROME_PATH = process.env.CHROME_PATH || getDefaultChromePath();

// To set up auth for the first time:
// 1. Close ALL Chrome windows
// 2. Run: pnpm run test:e2e:save-auth
// 3. In the Chrome window that opens, sign into Google manually
//    (go to accounts.google.com and sign in — NOT through the extension)
// 4. Then open the extension and sign in
// 5. Close the browser
//
// The key: the save-auth script does NOT use --enable-automation flag,
// so Google allows sign-in.

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  extensionPopup: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(AUTH_STATE_DIR)) {
      throw new Error(
        'Auth state not found. Run: pnpm run test:e2e:save-auth\n' +
        'Sign in manually, then close the browser.'
      );
    }

    const context = await chromium.launchPersistentContext(AUTH_STATE_DIR, {
      headless: false,
      executablePath: CHROME_PATH,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
        // These flags prevent the "controlled by automated software" banner
        // which causes Google to block sign-in
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    const extensionId = serviceWorker.url().split('/')[2]!;
    await use(extensionId);
  },

  extensionPopup: async ({ context, extensionId }, use) => {
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const page = await context.newPage();
    await page.goto(popupUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#auth-screen:not(.hidden), #main-screen:not(.hidden)', {
      timeout: 10000,
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
