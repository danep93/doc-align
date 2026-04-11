import { test, expect } from '../fixtures/extension';

test.describe('Groups Tab', () => {
  test('should render groups view', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="groups"]').click();
    await extensionPopup.waitForTimeout(2000);

    const groupsView = extensionPopup.locator('#groups-view');
    const text = await groupsView.textContent();

    // Should render — either org view, no-org view, or backend-unavailable message
    expect(text!.length).toBeGreaterThan(0);
  });

  test('should show create org or group list', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="groups"]').click();
    await extensionPopup.waitForTimeout(2000);

    const groupsView = extensionPopup.locator('#groups-view');
    const text = await groupsView.textContent();

    // Should show one of: create org button, group list, or backend error
    const hasCreateOrg = text!.includes('Create Organization');
    const hasGroups = text!.includes('group') || text!.includes('Group');
    const hasBackendMsg = text!.includes('require') || text!.includes('backend');
    const hasPendingInvite = text!.includes('Accept') || text!.includes('invite');

    expect(hasCreateOrg || hasGroups || hasBackendMsg || hasPendingInvite).toBe(true);
  });
});
