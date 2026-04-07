import { test, expect } from '../fixtures/extension';

test.describe('Sign Off', () => {
  test('should render sign-off view on default tab', async ({ extensionPopup }) => {
    const signoffView = extensionPopup.locator('#signoff-view');
    await expect(signoffView).toBeVisible();

    await extensionPopup.waitForTimeout(2000);
    const text = await signoffView.textContent();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });

  test('should show sign-off UI when on a Google Doc', async ({ context, extensionId }) => {
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(3000);

    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });
});
