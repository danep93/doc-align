import { test, expect } from '../fixtures/extension';

test.describe('Authentication', () => {
  test('should show signed-in state with email', async ({ extensionPopup }) => {
    const mainScreen = extensionPopup.locator('#main-screen');
    await expect(mainScreen).not.toHaveClass(/hidden/);

    const email = extensionPopup.locator('#user-email');
    await expect(email).toHaveText(/\S+@\S+/);
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

  test('auth persists across popup close and reopen', async ({ context, extensionId }) => {
    // Open popup, verify signed in
    const popup1 = await context.newPage();
    await popup1.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup1.waitForLoadState('domcontentloaded');
    await popup1.waitForSelector('#main-screen:not(.hidden)', { timeout: 10_000 });
    const email1 = await popup1.locator('#user-email').textContent();
    expect(email1).toMatch(/\S+@\S+/);

    // Close popup
    await popup1.close();

    // Reopen popup, verify still signed in (no double sign-in)
    const popup2 = await context.newPage();
    await popup2.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup2.waitForLoadState('domcontentloaded');
    await popup2.waitForSelector('#main-screen:not(.hidden)', { timeout: 10_000 });
    const email2 = await popup2.locator('#user-email').textContent();
    expect(email2).toBe(email1);
  });
});
