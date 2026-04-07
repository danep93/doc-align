import { test, expect } from '../fixtures/extension';

test.describe('Document Tracking', () => {
  test('should show track button or doc context on sign-off tab when on a Google Doc', async ({ context, extensionId }) => {
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

  test('should show tracked docs section in documents view without errors', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const trackedBtn = extensionPopup.locator('.docs-toggle-btn[data-toggle="tracked"]');
    const hasTrackedToggle = await trackedBtn.count() > 0;

    if (hasTrackedToggle) {
      await trackedBtn.click();
      await extensionPopup.waitForTimeout(1000);

      const docsView = extensionPopup.locator('#documents-view');
      const text = await docsView.textContent();

      expect(text!.length).toBeGreaterThan(0);
      expect(text).not.toContain('Error:');
      expect(text).not.toContain('undefined');
    }
  });
});
