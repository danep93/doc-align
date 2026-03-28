import { DEV_MODE } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { signOut } from '../../lib/auth';
import { loadThemePreference, saveThemePreference, resolveTheme, applyTheme, type ThemePreference } from '../../lib/theme';
import type { UserProfile } from '@doc-align/shared';

export async function renderSettingsView(container: HTMLElement): Promise<void> {
  const user = (await api.getUser()) as UserProfile;
  const currentTheme = await loadThemePreference();
  const existingSigs = await api.getSignatures();
  const hasSignature = Array.isArray(existingSigs) && existingSigs.length > 0;
  // If stored as 'system', default to 'dark'
  const effectiveTheme = currentTheme === 'system' ? 'dark' : currentTheme;

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <div class="form-label">Account</div>
      <div style="padding:10px 12px;background:var(--color-surface-2);border-radius:var(--radius-md);font-size:13px;">
        <div>${escapeHtml(user.email)}</div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px;">
          ${user.tier.toUpperCase()} plan
        </div>
      </div>
    </div>

    ${user.tier === 'free' ? `
    <button class="btn btn-primary" id="upgrade-btn" style="width:100%;margin-bottom:16px;">
      Upgrade to Pro
    </button>
    ` : ''}

    <div style="margin-bottom:16px;">
      <div class="form-label">Signatures</div>
      <button class="btn btn-ghost" id="manage-sigs-btn" style="width:100%;">
        ${hasSignature ? 'Change Signature' : 'Create New Signature'}
      </button>
    </div>

    <div style="margin-bottom:16px;">
      <div class="form-label">Theme</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost theme-btn ${effectiveTheme === 'dark' ? 'theme-btn-selected' : ''}" data-theme="dark" style="flex:1;font-size:11px;">Dark</button>
        <button class="btn btn-ghost theme-btn ${effectiveTheme === 'light' ? 'theme-btn-selected' : ''}" data-theme="light" style="flex:1;font-size:11px;">Light</button>
      </div>
    </div>

    <button class="btn btn-ghost" id="sign-out-btn" style="width:100%;color:var(--color-danger);">
      Sign Out
    </button>
  `;

  container.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pref = (btn as HTMLElement).dataset.theme as ThemePreference;
      await saveThemePreference(pref);
      applyTheme(resolveTheme(pref));
      container.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('theme-btn-selected'));
      btn.classList.add('theme-btn-selected');
    });
  });

  document.getElementById('upgrade-btn')?.addEventListener('click', async () => {
    const { url } = (await api.createCheckout('pro')) as { url: string };
    if (!DEV_MODE) chrome.tabs.create({ url });
  });

  document.getElementById('manage-sigs-btn')?.addEventListener('click', () => {
    document.getElementById('create-sig-modal')?.classList.remove('hidden');
  });

  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
