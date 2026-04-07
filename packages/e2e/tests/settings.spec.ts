import { test, expect } from '../fixtures/extension';

test.describe('Settings Tab', () => {
  test('should render settings with account info', async ({ extensionPopup }) => {
    // Click Settings tab
    await extensionPopup.locator('.tab[data-tab="settings"]').click();
    await extensionPopup.waitForTimeout(1000);

    // Should show account section with email
    const settingsView = extensionPopup.locator('#settings-view');
    await expect(settingsView).toContainText(/\S+@\S+/);
  });

  test('should show theme toggle with dark and light options', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="settings"]').click();
    await extensionPopup.waitForTimeout(1000);

    await expect(extensionPopup.locator('.theme-btn[data-theme="dark"]')).toBeVisible();
    await expect(extensionPopup.locator('.theme-btn[data-theme="light"]')).toBeVisible();
  });

  test('should show sign out button', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="settings"]').click();
    await extensionPopup.waitForTimeout(1000);

    const signOutBtn = extensionPopup.locator('#sign-out-btn');
    await expect(signOutBtn).toBeVisible();
    await expect(signOutBtn).toContainText('Sign Out');
  });

  test('should show signature management button', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="settings"]').click();
    await extensionPopup.waitForTimeout(1000);

    const sigBtn = extensionPopup.locator('#manage-sigs-btn');
    await expect(sigBtn).toBeVisible();
  });
});
