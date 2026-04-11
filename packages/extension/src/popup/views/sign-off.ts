import { STUB_GOOGLE_APIS } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { getLatestRevisionId, exportDocAsText, storeSnapshot } from '../../lib/google-apis';
import { renderSignatureImage, computeImageHash } from '../../lib/signature-renderer';
import { invalidateTab } from '../popup';
import { ensureContentScript, getActiveDocTab } from '../../lib/inject-content-script';
import { TIER_LIMITS, canTrackDocument } from '@doc-align/shared';
import type { Signature, SignOff, UserProfile, Tier, TrackedDoc } from '@doc-align/shared';

interface DocContext {
  docId: string;
  title: string;
}

export async function renderSignOffView(container: HTMLElement): Promise<void> {
  const docContext = await getDocContext();

  if (!docContext) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Open a Google Doc to sign off on it.</p>
      </div>
    `;
    return;
  }

  const [signatures, signOffs, profile, trackedDocs, isTracked] = await Promise.all([
    api.getSignatures() as Promise<Signature[]>,
    api.getSignOffs() as Promise<SignOff[]>,
    api.getUser() as Promise<UserProfile>,
    api.getTrackedDocs() as Promise<TrackedDoc[]>,
    api.isDocTracked(docContext.docId) as Promise<boolean>,
  ]);

  if (signatures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No signatures yet.</p>
        <button class="btn btn-primary mt-8" id="create-sig-trigger">Create Signature</button>
      </div>
    `;
    document.getElementById('create-sig-trigger')?.addEventListener('click', () => {
      document.getElementById('create-sig-modal')?.classList.remove('hidden');
    });
    return;
  }

  const tier = profile.tier as Tier;
  const isPremium = TIER_LIMITS[tier].maxCheckpointsPerDoc > 1;
  const existingForDoc = signOffs.filter((so) => so.documentId === docContext.docId);
  const alreadySigned = existingForDoc.length > 0;

  // Determine button text
  let buttonText: string;
  if (!alreadySigned) {
    buttonText = 'Sign This Doc';
  } else if (isPremium) {
    buttonText = 'Add Another Signature';
  } else {
    buttonText = 'Re-Sign This Doc';
  }

  // Determine track button state
  const trackedCount = trackedDocs.length;
  const atTrackingLimit = !canTrackDocument(tier, trackedCount);
  const showTrackButton = !alreadySigned; // Only show track button if doc is not signed

  let trackButtonHtml = '';
  if (showTrackButton) {
    if (isTracked) {
      trackButtonHtml = `
        <button class="btn btn-ghost" id="track-doc-btn" style="width:100%;margin-top:8px;" disabled>Already Tracking</button>
      `;
    } else if (atTrackingLimit) {
      trackButtonHtml = `
        <button class="btn btn-ghost" id="track-doc-btn" style="width:100%;margin-top:8px;" disabled>Tracking limit reached</button>
        <div style="font-size:11px;color:var(--color-text-secondary);text-align:center;margin-top:6px;">
          <a href="#" id="track-upgrade-link" style="color:var(--color-accent);text-decoration:none;">Upgrade to Pro</a> for up to 500 tracked documents
        </div>
      `;
    } else {
      trackButtonHtml = `
        <button class="btn btn-ghost" id="track-doc-btn" style="width:100%;margin-top:8px;">Track This Doc</button>
      `;
    }
  }

  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Current Document</div>
      <div style="font-size:14px;font-weight:500;margin-top:4px;">${escapeHtml(docContext.title)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Your Signature</div>
      <div id="active-sig-preview" class="sig-card">
        <div class="sig-card-preview">
          <img src="${signatures[0]!.drawingData}" alt="Signature" />
        </div>
        <div class="sig-card-info">
          <div class="sig-card-name">${escapeHtml(signatures[0]!.name)}</div>
          <div class="sig-card-meta">${signatures[0]!.format === 'full' && signatures[0]!.title ? signatures[0]!.title : 'Basic'}</div>
        </div>
      </div>
    </div>
    <div id="signoff-action-area">
      <button class="btn btn-primary" id="sign-off-btn" style="width:100%;">${buttonText}</button>
      ${trackButtonHtml}
    </div>
  `;

  document.getElementById('sign-off-btn')?.addEventListener('click', () => {
    if (alreadySigned && !isPremium) {
      // Free user re-signing — show inline confirmation
      showReSignConfirmation(container, docContext, signatures[0]!);
    } else {
      // First sign-off or premium user — just do it
      executeSignOff(docContext, signatures[0]!);
    }
  });

  document.getElementById('track-doc-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('track-doc-btn') as HTMLButtonElement;
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Tracking...';

    try {
      let revisionId: string;
      if (STUB_GOOGLE_APIS) {
        revisionId = await getDocTextHash();
      } else {
        revisionId = await getLatestRevisionId(docContext.docId);
        const docText = await exportDocAsText(docContext.docId);
        await storeSnapshot(docContext.docId, revisionId, docText);
      }

      await api.trackDoc({
        documentId: docContext.docId,
        title: docContext.title,
        baselineRevisionId: revisionId,
      });

      btn.textContent = 'Already Tracking';
      showToast('Now tracking this document');
      invalidateTab('documents');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Track doc error:', err);
      showToast(`Failed to track: ${msg}`);
      btn.disabled = false;
      btn.textContent = 'Track This Doc';
    }
  });

  document.getElementById('track-upgrade-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('.tab[data-tab="settings"]')?.dispatchEvent(new Event('click'));
  });
}

function showReSignConfirmation(container: HTMLElement, docContext: DocContext, sig: Signature): void {
  const actionArea = document.getElementById('signoff-action-area');
  if (!actionArea) return;

  actionArea.innerHTML = `
    <div class="resignoff-confirm">
      <div class="resignoff-confirm-warning">
        <div style="font-weight:600;margin-bottom:6px;">Reset your sign-off?</div>
        <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.5;">
          This will reset your change tracking for this document. Your previous diff history will be permanently deleted.
        </div>
        <div style="font-size:12px;margin-top:8px;">
          <a href="#" id="upgrade-hint" style="color:var(--color-accent);text-decoration:none;">Upgrade to Pro</a> for sign-off history — keep up to 10 checkpoints per document.
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" id="resign-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-danger" id="resign-confirm" style="flex:1;">Reset Sign-off</button>
      </div>
    </div>
  `;

  document.getElementById('resign-cancel')?.addEventListener('click', () => {
    // Restore original button
    actionArea.innerHTML = `
      <button class="btn btn-primary" id="sign-off-btn" style="width:100%;">Re-Sign This Doc</button>
    `;
    document.getElementById('sign-off-btn')?.addEventListener('click', () => {
      showReSignConfirmation(container, docContext, sig);
    });
  });

  document.getElementById('resign-confirm')?.addEventListener('click', () => {
    const btn = document.getElementById('resign-confirm') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    executeSignOff(docContext, sig);
  });

  document.getElementById('upgrade-hint')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Switch to settings tab and trigger upgrade
    document.querySelector('.tab[data-tab="settings"]')?.dispatchEvent(new Event('click'));
  });
}

async function executeSignOff(docContext: DocContext, sig: Signature): Promise<void> {
  try {
    const now = new Date();
    const dateTimeStr = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const imageDataUrl = await renderSignatureImage({
      drawingDataUrl: sig.drawingData,
      name: sig.name,
      date: dateTimeStr,
      title: sig.title,
      organization: sig.organization,
      format: sig.format,
    });

    const imageHash = await computeImageHash(imageDataUrl);

    let revisionId: string;
    if (STUB_GOOGLE_APIS) {
      revisionId = await getDocTextHash();
    } else {
      revisionId = await getLatestRevisionId(docContext.docId);
      const docText = await exportDocAsText(docContext.docId);
      await storeSnapshot(docContext.docId, revisionId, docText);
    }

    await copyImageToClipboard(imageDataUrl);
    showToast('Signature copied to clipboard — paste it into your doc (⌘V)');

    await api.createSignOff({
      signatureId: sig.id,
      documentId: docContext.docId,
      revisionId,
      imageHash,
      documentTitle: docContext.title,
    });

    // If doc was tracked, remove tracking (signed docs are not tracked)
    const wasTracked = await api.isDocTracked(docContext.docId);
    if (wasTracked) {
      await api.untrackDoc(docContext.docId);
    }

    // Update the action area to show success
    const actionArea = document.getElementById('signoff-action-area');
    if (actionArea) {
      actionArea.innerHTML = `
        <button class="btn btn-primary" id="sign-off-btn" style="width:100%;background:var(--color-success);border-color:var(--color-success);" disabled>
          Signed! Paste into doc (⌘V)
        </button>
      `;
    }

    invalidateTab('documents');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Sign-off error:', err);
    showToast(`Failed to sign off: ${msg}`);

    // Restore button
    const actionArea = document.getElementById('signoff-action-area');
    if (actionArea) {
      actionArea.innerHTML = `
        <button class="btn btn-primary" id="sign-off-btn" style="width:100%;">Sign This Doc</button>
      `;
    }
  }
}

async function getDocContext(): Promise<DocContext | null> {
  const tab = await getActiveDocTab();
  if (!tab) return null;

  await ensureContentScript(tab.tabId);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.tabId, { type: 'GET_DOC_INFO' }, (response) => {
      if (chrome.runtime.lastError || !response?.docId) {
        resolve(null);
        return;
      }
      resolve({ docId: response.docId, title: response.title });
    });
  });
}

async function getDocTextHash(): Promise<string> {
  const tab = await getActiveDocTab();
  if (!tab) throw new Error('No active Google Doc tab');

  await ensureContentScript(tab.tabId);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.tabId, { type: 'GET_DOC_TEXT_HASH' }, (response) => {
      if (chrome.runtime.lastError || !response?.hash) {
        reject(new Error('Failed to get doc text hash'));
        return;
      }
      resolve(response.hash);
    });
  });
}

async function copyImageToClipboard(dataUrl: string): Promise<void> {
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

function showToast(message: string, duration = 3000): void {
  const existing = document.querySelector('.da-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'da-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('da-toast-visible'));

  setTimeout(() => {
    toast.classList.remove('da-toast-visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
