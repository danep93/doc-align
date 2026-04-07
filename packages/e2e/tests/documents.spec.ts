import { test, expect } from '../fixtures/extension';

test.describe('My Documents Tab', () => {
  test('should render documents view without errors', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const docsView = extensionPopup.locator('#documents-view');
    const text = await docsView.textContent();

    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  test('should show signed/tracked toggle or empty state', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const docsView = extensionPopup.locator('#documents-view');
    const text = await docsView.textContent();

    const hasToggle = await extensionPopup.locator('.docs-toggle-btn').count() > 0;
    const hasEmptyState = text!.includes('No signed or tracked documents');
    expect(hasToggle || hasEmptyState).toBe(true);
  });

  test('should show open full view button when docs exist', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const openBtn = extensionPopup.locator('.docs-open-tab-btn');
    const hasOpenBtn = await openBtn.count() > 0;

    if (hasOpenBtn) {
      await expect(openBtn).toContainText('Open full view');
    }
  });
});
