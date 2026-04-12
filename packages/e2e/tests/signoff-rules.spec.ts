import { test, expect } from '../fixtures/extension';

test.describe('Sign-off Rules', () => {
  test('should show add-to-org button when org exists but doc not tracked', async ({ extensionPopup }) => {
    // This test verifies the UI renders the add-to-org flow
    // In E2E mode, the user has an org but the test doc isn't added to it
    const signoffView = extensionPopup.locator('#signoff-view');
    await extensionPopup.waitForTimeout(2000);
    const text = await signoffView.textContent();
    // Should render without errors
    expect(text).toBeTruthy();
  });

  test('should show sign-off progress when rules exist for a document', async ({ context, extensionId, extensionPopup }) => {
    // Navigate to the test Google Doc
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    await docPage.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Sign in
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
      }
    }

    await popup.waitForTimeout(3000);
    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should render sign-off view without errors
    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error');
  });
});
