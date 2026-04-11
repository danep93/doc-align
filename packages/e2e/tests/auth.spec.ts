import { test, expect } from '../fixtures/extension';

test.describe('Authentication', () => {
  test('should show signed-in state with email', async ({ extensionPopup }) => {
    // Check that main screen is visible (not auth screen)
    const mainScreen = extensionPopup.locator('#main-screen');
    await expect(mainScreen).not.toHaveClass(/hidden/);

    // Check email is displayed
    const email = extensionPopup.locator('#user-email');
    await expect(email).toHaveText(/\S+@\S+/); // matches any email
  });

  test('should show tier badge', async ({ extensionPopup }) => {
    const badge = extensionPopup.locator('#tier-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/FREE|PRO|ENTERPRISE/);
  });

  test('should have all four tabs', async ({ extensionPopup }) => {
    await expect(extensionPopup.locator('.tab[data-tab="signoff"]')).toBeVisible();
    await expect(extensionPopup.locator('.tab[data-tab="documents"]')).toBeVisible();
    await expect(extensionPopup.locator('.tab[data-tab="groups"]')).toBeVisible();
    await expect(extensionPopup.locator('.tab[data-tab="settings"]')).toBeVisible();
  });
});
