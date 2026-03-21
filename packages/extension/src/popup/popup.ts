import './popup.css';
import { signIn, onAuthChange } from '../lib/auth';
import { initTheme } from '../lib/theme';
import { renderSignOffView } from './views/sign-off';
import { renderDocumentsView } from './views/documents';
import { renderSettingsView } from './views/settings';
import { initCreateSignatureModal } from './components/create-signature-modal';
import { api } from '../lib/api';
import type { UserProfile } from '@doc-align/shared';

// Init theme
initTheme();

// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    const target = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${target}`)?.classList.add('active');

    // Lazy-load tab content
    if (target === 'signoff') renderSignOffView(document.getElementById('signoff-view')!);
    if (target === 'documents') renderDocumentsView(document.getElementById('documents-view')!);
    if (target === 'settings') renderSettingsView(document.getElementById('settings-view')!);
  });
});

// Modal close handlers
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-overlay')?.classList.add('hidden');
  });
});

// Diff modal close
document.getElementById('diff-close')?.addEventListener('click', () => {
  document.getElementById('diff-modal')?.classList.add('hidden');
});

// Auth state
onAuthChange(async (user) => {
  const authScreen = document.getElementById('auth-screen')!;
  const mainScreen = document.getElementById('main-screen')!;

  if (user) {
    authScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');

    const emailEl = document.getElementById('user-email')!;
    emailEl.textContent = user.email || '';

    try {
      const profile = (await api.getUser()) as UserProfile;
      const badge = document.getElementById('tier-badge')!;
      badge.textContent = profile.tier.toUpperCase();
      badge.className = `tier-badge ${profile.tier}`;

      initCreateSignatureModal(profile.tier, () => {
        renderSignOffView(document.getElementById('signoff-view')!);
      });
    } catch {
      // Continue without tier info
    }

    renderSignOffView(document.getElementById('signoff-view')!);
  } else {
    authScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }
});

// Sign in button
document.getElementById('sign-in-btn')?.addEventListener('click', async () => {
  try {
    await signIn();
  } catch (err) {
    alert('Sign-in failed. Please try again.');
  }
});
