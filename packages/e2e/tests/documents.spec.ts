import { test, expect } from '../fixtures/extension';

test.describe('My Documents Tab', () => {
  test('should render documents view with toggle', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const docsView = extensionPopup.locator('#documents-view');
    const text = await docsView.textContent();

    // Should render something — either docs, empty state, or toggle
    expect(text!.length).toBeGreaterThan(0);

    // Should not show a raw error
    expect(text).not.toContain('Error:');
  });

  test('should show signed/tracked toggle if docs exist', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const docsView = extensionPopup.locator('#documents-view');
    const text = await docsView.textContent();

    // Either shows toggle buttons or empty state
    const hasToggle = await extensionPopup.locator('.docs-toggle-btn').count() > 0;
    const hasEmptyState = text!.includes('No signed or tracked documents');

    expect(hasToggle || hasEmptyState).toBe(true);
  });

  test('should show open full view button when docs exist', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const openBtn = extensionPopup.locator('.docs-open-tab-btn');
    const hasOpenBtn = await openBtn.count() > 0;

    // Button only exists when there are docs
    if (hasOpenBtn) {
      await expect(openBtn).toContainText('Open full view');
    }
  });
});
