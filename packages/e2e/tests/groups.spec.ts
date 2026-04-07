import { test, expect } from '../fixtures/extension';

test.describe('Groups Tab', () => {
  test('should render groups view without errors', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="groups"]').click();
    await extensionPopup.waitForTimeout(2000);

    const groupsView = extensionPopup.locator('#groups-view');
    const text = await groupsView.textContent();

    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });

  test('should show create org, group list, or tier gate message', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="groups"]').click();
    await extensionPopup.waitForTimeout(2000);

    const groupsView = extensionPopup.locator('#groups-view');
    const text = await groupsView.textContent();

    const hasCreateOrg = text!.includes('Create Organization');
    const hasGroups = text!.toLowerCase().includes('group');
    const hasTierGate = text!.includes('require') || text!.includes('upgrade') || text!.includes('Pro');
    const hasBackendMsg = text!.includes('backend');
    const hasPendingInvite = text!.includes('Accept') || text!.includes('invite');

    expect(hasCreateOrg || hasGroups || hasTierGate || hasBackendMsg || hasPendingInvite).toBe(true);
  });
});
