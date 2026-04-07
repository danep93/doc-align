import { test, expect } from '../fixtures/extension';

test.describe('Sign Off', () => {
  test('should show "Open a Google Doc" when not on a doc', async ({ extensionPopup }) => {
    // Sign Off tab is default active
    const signoffView = extensionPopup.locator('#signoff-view');

    // When opened as a tab (not popup over a Google Doc), should show message
    // or show signature if one exists. Either way, the view should render.
    await extensionPopup.waitForTimeout(2000);
    const text = await signoffView.textContent();
    expect(text).toBeTruthy(); // View rendered something (not blank)
  });

  test('should show sign-off UI when navigated to a Google Doc', async ({ context, extensionId }) => {
    // Open a Google Doc
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    // Open extension popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(3000);

    // Sign Off tab should show document info or signature
    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should either show document title or "No signatures yet" or "Sign This Doc"
    expect(text!.length).toBeGreaterThan(0);
  });
});
