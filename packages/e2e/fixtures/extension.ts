import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');

// E2E tests use Playwright's bundled Chromium with the extension built in E2E_MODE.
// E2E_MODE uses real Firebase auth (email/password) and real backend API,
// but stubs Google Drive/Docs APIs (chrome.identity OAuth unavailable in Chromium).

const E2E_EMAIL = process.env.E2E_EMAIL || 'e2e-test@doc-align-test.com';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'e2e-test-secure-pw-2026';

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  extensionPopup: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Chromium extensions require headless: false even in CI (uses Xvfb)
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
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

    // Wait for either screen to appear
    await page.waitForSelector('#auth-screen:not(.hidden), #main-screen:not(.hidden)', {
      timeout: 10000,
    });

    // If auth screen is shown, sign in via E2E bridge
    const authScreen = page.locator('#auth-screen:not(.hidden)');
    if (await authScreen.isVisible()) {
      // Try E2E email/password sign-in (real Firebase auth)
      const hasE2eBridge = await page.evaluate(() => typeof (window as any).__e2eSignIn === 'function');
      if (hasE2eBridge) {
        await page.evaluate(
          async ({ email, password }) => await (window as any).__e2eSignIn(email, password),
          { email: E2E_EMAIL, password: E2E_PASSWORD },
        );
        await page.waitForSelector('#main-screen:not(.hidden)', { timeout: 10000 });
      } else {
        // Fallback: click sign-in button (works in DEV_MODE builds)
        await page.click('#sign-in-btn');
        await page.waitForSelector('#main-screen:not(.hidden)', { timeout: 10000 });
      }
    }

    await use(page);
  },
});

export { expect } from '@playwright/test';
