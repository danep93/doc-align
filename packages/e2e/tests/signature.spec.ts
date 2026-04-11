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

    // Verify the signature was saved by re-opening the modal — it should show existing signature
    await extensionPopup.locator('#manage-sigs-btn').click();
    await extensionPopup.waitForTimeout(500);
    // The name field should be pre-filled or the signature list should show the entry
    const nameInput = extensionPopup.locator('#sig-name');
    const nameValue = await nameInput.inputValue();
    // If the modal resets, check the settings button text changed
    if (!nameValue) {
      const btn = extensionPopup.locator('#manage-sigs-btn');
      const btnText = await btn.textContent();
      expect(btnText).not.toBe('Create New Signature');
    } else {
      expect(nameValue).toBe('Test User');
    }
  });
});
