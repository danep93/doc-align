import './popup.css';
import { signIn, onAuthChange } from '../lib/auth';
import { initTheme } from '../lib/theme';
import { renderSignOffView } from './views/sign-off';
import { renderDocumentsView, handleReSignOff } from './views/documents';
import { renderSettingsView } from './views/settings';
import { initCreateSignatureModal } from './components/create-signature-modal';
import { api } from '../lib/api';
import type { UserProfile } from '@doc-align/shared';

// Init theme
initTheme();

// Track which tabs have been rendered
const renderedTabs = new Set<string>();

// Tab switching — only render on first visit
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    const target = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${target}`)?.classList.add('active');

    if (!renderedTabs.has(target || '')) {
      renderTab(target || '');
    }
  });
});

function renderTab(target: string): void {
  renderedTabs.add(target);
  if (target === 'signoff') renderSignOffView(document.getElementById('signoff-view')!);
  if (target === 'documents') renderDocumentsView(document.getElementById('documents-view')!);
  if (target === 'settings') renderSettingsView(document.getElementById('settings-view')!);
}

// Force re-render a tab (e.g., after sign-off changes data)
export function invalidateTab(target: string): void {
  renderedTabs.delete(target);
}

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

// Re-Sign Off button in diff modal
document.getElementById('diff-resignoff')?.addEventListener('click', () => {
  handleReSignOff();
});

// Auth state — wait briefly for Firebase to restore persisted session
let authResolved = false;
onAuthChange(async (user) => {
  const authScreen = document.getElementById('auth-screen')!;
  const mainScreen = document.getElementById('main-screen')!;

  if (user) {
    authResolved = true;
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
        invalidateTab('signoff');
        renderTab('signoff');
      });
    } catch {
      // Continue without tier info — init modal with free tier
      initCreateSignatureModal('free', () => {
        invalidateTab('signoff');
        renderTab('signoff');
      });
    }

    // Preload all tabs so switching is instant
    renderTab('signoff');
    renderTab('documents');
    renderTab('settings');
  } else if (!authResolved) {
    // First null callback — wait a moment for Firebase to restore session
    setTimeout(() => {
      if (!authResolved) {
        authScreen.classList.remove('hidden');
        mainScreen.classList.add('hidden');
      }
    }, 500);
  } else {
    // User actually signed out
    authScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }
});

// Sign in button
document.getElementById('sign-in-btn')?.addEventListener('click', async () => {
  try {
    await signIn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Sign-in error:', err);
    alert(`Sign-in failed: ${msg}`);
  }
});
