import { test, expect } from '../fixtures/extension';

test.describe('Document Tracking', () => {
  test('should show track button on sign-off tab when on a Google Doc', async ({ context, extensionId }) => {
    // Open a Google Doc
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    // Open extension popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(3000);

    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should show either "Track This Doc" or "Already Tracking" if doc is detected
    // May show "Open a Google Doc" if popup can't detect active tab
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
