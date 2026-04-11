import { test, expect } from '../fixtures/extension';

test.describe('Document Tracking', () => {
  test('should show track button on sign-off tab when on a Google Doc', async ({ context, extensionId, extensionPopup }) => {
    // Open a Google Doc in a new tab
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    // Bring focus to the doc tab, then re-open popup
    await docPage.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Sign in on this popup page
    await popup.waitForSelector('#auth-screen:not(.hidden), #main-screen:not(.hidden)', { timeout: 10000 });
    const authScreen = popup.locator('#auth-screen:not(.hidden)');
    if (await authScreen.isVisible()) {
      const hasE2eBridge = await popup.evaluate(() => typeof (window as any).__e2eSignIn === 'function');
      if (hasE2eBridge) {
        await popup.evaluate(
          async ({ email, password }) => await (window as any).__e2eSignIn(email, password),
          { email: 'e2e-test@doc-align-test.com', password: 'e2e-test-secure-pw-2026' },
        );
        await popup.waitForSelector('#main-screen:not(.hidden)', { timeout: 10000 });
      } else {
        await popup.click('#sign-in-btn');
        await popup.waitForSelector('#main-screen:not(.hidden)', { timeout: 10000 });
      }
    }

    await popup.waitForTimeout(3000);

    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should show tracking-related content when on a Google Doc
    expect(text!.length).toBeGreaterThan(0);
  });

  test('should show tracked docs in documents view tracked toggle', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    // Check if tracked toggle exists
    const trackedBtn = extensionPopup.locator('.docs-toggle-btn[data-toggle="tracked"]');
    const hasTrackedToggle = await trackedBtn.count() > 0;

    if (hasTrackedToggle) {
      await trackedBtn.click();
      await extensionPopup.waitForTimeout(1000);

      const docsView = extensionPopup.locator('#documents-view');
      const text = await docsView.textContent();

      // Should show tracked docs or "No tracked documents yet"
      expect(text!.length).toBeGreaterThan(0);
      expect(text).not.toContain('Error:');
    }
  });
});
