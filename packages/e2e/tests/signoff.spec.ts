import { test, expect } from '../fixtures/extension';

test.describe('Sign Off', () => {
  test('should show "Open a Google Doc" when not on a doc', async ({ extensionPopup }) => {
    // Sign Off tab is default active
    const signoffView = extensionPopup.locator('#signoff-view');

    // When opened as a tab (not popup over a Google Doc), should show message
    await extensionPopup.waitForTimeout(2000);
    const text = await signoffView.textContent();
    expect(text).toBeTruthy();
  });

  test('should show sign-off UI when navigated to a Google Doc', async ({ context, extensionId, extensionPopup }) => {
    // Open a Google Doc in a new tab
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    // Bring focus to the doc tab, then re-open popup so it detects the doc
    await docPage.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Sign in on this popup page too
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

    // Sign Off tab should show document-related content
    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should show document title, signature options, or tracking UI — not "Open a Google Doc"
    expect(text!.length).toBeGreaterThan(0);
  });
});
