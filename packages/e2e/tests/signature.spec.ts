import { test, expect } from '../fixtures/extension';

test.describe('Signature Management', () => {
  test('should open create signature modal from settings', async ({ extensionPopup }) => {
    // Go to settings
    await extensionPopup.locator('.tab[data-tab="settings"]').click();
    await extensionPopup.waitForTimeout(1000);

    // Click create/change signature button
    await extensionPopup.locator('#manage-sigs-btn').click();

    // Modal should appear
    const modal = extensionPopup.locator('#create-sig-modal');
    await expect(modal).not.toHaveClass(/hidden/);

    // Should have canvas, name input, and save button
    await expect(extensionPopup.locator('#sig-draw-canvas')).toBeVisible();
    await expect(extensionPopup.locator('#sig-name')).toBeVisible();
    await expect(extensionPopup.locator('#create-sig-save')).toBeVisible();
  });

  test('should create a signature with name and drawing', async ({ extensionPopup }) => {
    // Go to settings
    await extensionPopup.locator('.tab[data-tab="settings"]').click();
    await extensionPopup.waitForTimeout(1000);

    // Open modal
    await extensionPopup.locator('#manage-sigs-btn').click();
    await extensionPopup.waitForTimeout(500);

    // Type name
    await extensionPopup.locator('#sig-name').fill('Test User');

    // Draw on canvas (simulate a simple stroke)
    const canvas = extensionPopup.locator('#sig-draw-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await extensionPopup.mouse.move(box.x + 50, box.y + 40);
      await extensionPopup.mouse.down();
      await extensionPopup.mouse.move(box.x + 150, box.y + 60, { steps: 10 });
      await extensionPopup.mouse.move(box.x + 200, box.y + 40, { steps: 10 });
      await extensionPopup.mouse.up();
    }

    // Wait for preview to render
    await extensionPopup.waitForTimeout(500);

    // Save
    await extensionPopup.locator('#create-sig-save').click();

    // Modal should close
    await extensionPopup.waitForTimeout(1000);
    const modal = extensionPopup.locator('#create-sig-modal');
    await expect(modal).toHaveClass(/hidden/);

    // Sign Off tab should now show the signature
    await extensionPopup.locator('.tab[data-tab="signoff"]').click();
    await extensionPopup.waitForTimeout(1000);

    const signoffView = extensionPopup.locator('#signoff-view');
    await expect(signoffView).toContainText('Test User');
  });
});
