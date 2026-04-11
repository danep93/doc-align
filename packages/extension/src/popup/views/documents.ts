import { STUB_GOOGLE_APIS } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { getLatestRevisionId, exportDocAsText, storeSnapshot } from '../../lib/google-apis';
import { renderDocCard } from '../components/doc-card';
import { renderDiffViewerWithCheckpoints } from '../components/diff-viewer';
import { renderSignatureImage, computeImageHash } from '../../lib/signature-renderer';
import { invalidateTab } from '../popup';
import { ensureContentScript, getActiveDocTab } from '../../lib/inject-content-script';
import { TIER_LIMITS } from '@doc-align/shared';
import type { SignOff, DocReference, DocSignOffSummary, UserProfile, Signature, Tier, TrackedDoc } from '@doc-align/shared';

async function refreshDocTitles(docRefs: DocReference[]): Promise<void> {
  const tab = await getActiveDocTab();
  if (!tab) return;

  for (const docRef of docRefs) {
    if (tab.url.includes(`docs.google.com/document/d/${docRef.id}`)) {
      const currentTitle = tab.title.replace(' - Google Docs', '').trim();
      if (currentTitle && currentTitle !== docRef.title) {
        docRef.title = currentTitle;
        await updateDocRefTitle(docRef.id, currentTitle);
      }
      break;
    }
  }
}

async function updateDocRefTitle(docId: string, newTitle: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get('local_docrefs', (result) => {
      const refs = (result.local_docrefs || []) as DocReference[];
      const ref = refs.find((r) => r.id === docId);
      if (ref) {
        ref.title = newTitle;
        ref.updatedAt = new Date().toISOString();
        chrome.storage.local.set({ local_docrefs: refs }, resolve);
      } else {
        resolve();
      }
    });
  });
}

// Get text hash from the content script of a tab with the given doc ID.
// Only works in DEV_MODE, and only if the doc is the currently active tab.
async function getDocTextHash(docId: string): Promise<string | null> {
  if (!STUB_GOOGLE_APIS) return null;

  const tab = await getActiveDocTab();
  if (!tab || !tab.url.includes(`docs.google.com/document/d/${docId}`)) return null;

  await ensureContentScript(tab.tabId);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.tabId, { type: 'GET_DOC_TEXT_HASH' }, (response) => {
      if (chrome.runtime.lastError || !response?.hash) {
        resolve(null);
        return;
      }
      resolve(response.hash);
    });
  });
}

// State for the currently displayed diff modal context
let currentDiffDocId: string | null = null;
let currentDiffDocTitle: string | null = null;

// State for the Signed/Tracked toggle
let activeDocToggle: 'signed' | 'tracked' = 'signed';

// Cached data to avoid re-fetching on toggle
let cachedSignOffs: SignOff[] | null = null;
let cachedDocRefs: DocReference[] | null = null;
let cachedProfile: UserProfile | null = null;
let cachedTrackedDocs: TrackedDoc[] | null = null;

export function clearDocumentsCache(): void {
  cachedSignOffs = null;
  cachedDocRefs = null;
  cachedProfile = null;
  cachedTrackedDocs = null;
}

export function getCurrentDiffDocId(): string | null {
  return currentDiffDocId;
}

export function getCurrentDiffDocTitle(): string | null {
  return currentDiffDocTitle;
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

async function copyImageToClipboard(dataUrl: string): Promise<void> {
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

export async function handleReSignOff(): Promise<void> {
  const docId = currentDiffDocId;
  const docTitle = currentDiffDocTitle;
  if (!docId || !docTitle) return;

  const profile = (await api.getUser()) as UserProfile;
  const tier = profile.tier as Tier;
  const isFree = tier === 'free';

  if (isFree) {
    showReSignOffConfirmation(docId, docTitle);
    return;
  }

  // Premium users: just add a new checkpoint
  await executeReSignOff(docId, docTitle);
}

function showReSignOffConfirmation(docId: string, docTitle: string): void {
  const footer = document.querySelector('#diff-modal .modal-footer') as HTMLElement;
  if (!footer) return;

  footer.innerHTML = `
    <div class="resignoff-confirm">
      <div class="resignoff-confirm-warning">
        <div style="font-weight:600;margin-bottom:6px;">Reset your sign-off?</div>
        <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.5;">
          This will remove your current sign-off and create a new one at the latest version.
          The document will appear as <strong>up to date</strong> and your previous change
          history for this document will be permanently deleted.
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-ghost" id="resignoff-cancel">Cancel</button>
        <button class="btn btn-danger" id="resignoff-confirm">Reset Sign-off</button>
      </div>
    </div>
  `;

  document.getElementById('resignoff-cancel')?.addEventListener('click', () => {
    restoreFooter();
  });

  document.getElementById('resignoff-confirm')?.addEventListener('click', async () => {
    const confirmBtn = document.getElementById('resignoff-confirm') as HTMLButtonElement;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Replacing...';
    await executeReSignOff(docId, docTitle);
  });
}

function restoreFooter(): void {
  const footer = document.querySelector('#diff-modal .modal-footer') as HTMLElement;
  if (!footer) return;
  footer.innerHTML = `
    <button class="btn btn-ghost" id="diff-close">Close</button>
    <button class="btn btn-primary" id="diff-resignoff">Reset Sign-off</button>
  `;
  // Re-attach event listeners
  document.getElementById('diff-close')?.addEventListener('click', () => {
    document.getElementById('diff-modal')?.classList.add('hidden');
  });
  document.getElementById('diff-resignoff')?.addEventListener('click', () => {
    handleReSignOff();
  });
}

async function executeReSignOff(docId: string, docTitle: string): Promise<void> {
  const signatures = (await api.getSignatures()) as Signature[];
  if (signatures.length === 0) {
    restoreFooter();
    const footer = document.querySelector('#diff-modal .modal-footer') as HTMLElement;
    if (footer) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:var(--color-danger);font-size:12px;padding:8px 0;';
      msg.textContent = 'No active signature found. Please create one in Settings first.';
      footer.prepend(msg);
    }
    return;
  }

  try {
    const sig = signatures[0]!;

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
      const hash = await getDocTextHash(docId);
      if (!hash) throw new Error('Cannot get document text hash');
      revisionId = hash;
    } else {
      revisionId = await getLatestRevisionId(docId);
      const docText = await exportDocAsText(docId);
      await storeSnapshot(docId, revisionId, docText);
    }

    await copyImageToClipboard(imageDataUrl);
    showToast('Signature copied to clipboard — paste it into your doc (⌘V)');

    // createSignOff handles pruning automatically based on tier
    await api.createSignOff({
      signatureId: sig.id,
      documentId: docId,
      revisionId,
      imageHash,
      documentTitle: docTitle,
    });

    // Show success and close
    restoreFooter();
    const btn = document.getElementById('diff-resignoff') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = 'Re-signed! Paste (⌘V)';
      btn.style.background = 'var(--color-success)';
      btn.style.borderColor = 'var(--color-success)';
      btn.disabled = true;
    }

    setTimeout(() => {
      document.getElementById('diff-modal')?.classList.add('hidden');
      restoreFooter();
      const docsView = document.getElementById('documents-view');
      if (docsView) renderDocumentsView(docsView);
    }, 1500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Re-sign-off error:', err);
    restoreFooter();
    const footer = document.querySelector('#diff-modal .modal-footer') as HTMLElement;
    if (footer) {
      const errMsg = document.createElement('div');
      errMsg.style.cssText = 'color:var(--color-danger);font-size:12px;padding:8px 0;';
      errMsg.textContent = `Failed: ${msg}`;
      footer.prepend(errMsg);
    }
  }
}

export async function renderDocumentsView(container: HTMLElement): Promise<void> {
  const needsFetch = !cachedSignOffs || !cachedDocRefs || !cachedProfile || !cachedTrackedDocs;

  if (needsFetch) {
    container.innerHTML = '<div class="docs-loading"><div class="docs-spinner"></div><p>Loading documents...</p></div>';
  }

  try {
    // Use cached data if available (toggling doesn't re-fetch)
    if (needsFetch) {
      const [signOffs, docRefs, profile, trackedDocs] = await Promise.all([
        api.getSignOffs() as Promise<SignOff[]>,
        api.getDocuments() as Promise<DocReference[]>,
        api.getUser() as Promise<UserProfile>,
        api.getTrackedDocs() as Promise<TrackedDoc[]>,
      ]);
      cachedSignOffs = signOffs;
      cachedDocRefs = docRefs;
      cachedProfile = profile;
      cachedTrackedDocs = trackedDocs;
    }

    const signOffs = cachedSignOffs!;
    const docRefs = cachedDocRefs!;
    const profile = cachedProfile!;
    const trackedDocs = cachedTrackedDocs!;

    const tier = profile.tier as Tier;
    const isPremium = TIER_LIMITS[tier].maxCheckpointsPerDoc > 1;
    const hasSignedDocs = docRefs.length > 0;
    const hasTrackedDocs = trackedDocs.length > 0;

    if (!hasSignedDocs && !hasTrackedDocs) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No signed or tracked documents yet.</p>
          <p>Sign off on or track a Google Doc to see it here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    // Toggle bar
    const toggleBar = document.createElement('div');
    toggleBar.className = 'docs-toggle-bar';
    toggleBar.innerHTML = `
      <button class="btn btn-ghost btn-sm docs-toggle-btn ${activeDocToggle === 'signed' ? 'theme-btn-selected' : ''}" data-toggle="signed">Signed</button>
      <button class="btn btn-ghost btn-sm docs-toggle-btn ${activeDocToggle === 'tracked' ? 'theme-btn-selected' : ''}" data-toggle="tracked">Tracked</button>
    `;
    container.appendChild(toggleBar);

    toggleBar.querySelectorAll('.docs-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const newToggle = (btn as HTMLElement).dataset.toggle as 'signed' | 'tracked';
        if (newToggle === activeDocToggle) return;
        activeDocToggle = newToggle;
        // Re-render without clearing cache (instant toggle)
        renderDocumentsView(container);
      });
    });

    // Summary header
    const summaryEl = document.createElement('div');
    summaryEl.className = 'docs-summary';
    container.appendChild(summaryEl);

    // Open in new tab button
    const openTabBtn = document.createElement('button');
    openTabBtn.className = 'btn btn-ghost docs-open-tab-btn';
    openTabBtn.textContent = 'Open full view';
    openTabBtn.addEventListener('click', () => {
      const extUrl = chrome.runtime.getURL('popup/popup.html?view=documents');
      chrome.tabs.create({ url: extUrl });
    });
    container.appendChild(openTabBtn);

    // Cards container — separate from toggle/summary so views don't mix
    const cardsContainer = document.createElement('div');
    cardsContainer.id = 'docs-cards-container';
    container.appendChild(cardsContainer);

    if (activeDocToggle === 'signed') {
      await renderSignedView(cardsContainer, summaryEl, docRefs, signOffs, isPremium);
    } else {
      await renderTrackedView(cardsContainer, summaryEl, trackedDocs, tier);
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load documents.</p></div>';
  }
}

async function renderSignedView(
  cardsContainer: HTMLElement,
  summaryEl: HTMLElement,
  docRefs: DocReference[],
  signOffs: SignOff[],
  isPremium: boolean,
): Promise<void> {
  if (docRefs.length === 0) {
    summaryEl.innerHTML = '';
    cardsContainer.innerHTML = '<div class="empty-state"><p>No signed documents yet.</p></div>';
    return;
  }

  // Refresh doc titles from any open tabs
  await refreshDocTitles(docRefs);

  // Prepare doc data with sign-offs
  const docData = docRefs
    .map((docRef) => {
      const mySignOffs = signOffs
        .filter((so) => so.documentId === docRef.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { docRef, mySignOffs, latestSignOff: mySignOffs[0] };
    })
    .filter((d) => d.latestSignOff);

  // Check all docs for changes in parallel
  const changeResults = await Promise.all(
    docData.map(async ({ docRef, latestSignOff }) => {
      try {
        if (STUB_GOOGLE_APIS) {
          const currentHash = await getDocTextHash(docRef.id);
          return currentHash ? currentHash !== latestSignOff!.revisionId : false;
        } else {
          const currentRevId = await getLatestRevisionId(docRef.id);
          return currentRevId !== latestSignOff!.revisionId;
        }
      } catch {
        return false;
      }
    }),
  );

  // Build all cards at once
  const fragment = document.createDocumentFragment();
  let changedCount = 0;

  docData.forEach(({ docRef, mySignOffs, latestSignOff }, i) => {
    const hasChanged = changeResults[i]!;
    if (hasChanged) changedCount++;

    const summary: DocSignOffSummary = {
      documentId: docRef.id,
      title: docRef.title,
      mySignOffDate: latestSignOff!.createdAt,
      myRevisionId: latestSignOff!.revisionId,
      totalSignOffsOnRevision: 1,
      signerNames: [],
      hasChanged,
    };

    const card = renderDocCard(summary, () => {
      currentDiffDocId = docRef.id;
      currentDiffDocTitle = docRef.title;
      const diffModal = document.getElementById('diff-modal')!;
      const diffBody = document.getElementById('diff-body')!;
      diffModal.classList.remove('hidden');
      renderDiffViewerWithCheckpoints({ container: diffBody, docId: docRef.id, signOffs: mySignOffs, isPremium });
    });
    fragment.appendChild(card);
  });

  cardsContainer.appendChild(fragment);

  summaryEl.innerHTML = `
    <div class="docs-summary-stats">
      <div class="docs-stat">
        <div class="docs-stat-value">${docData.length}</div>
        <div class="docs-stat-label">${docData.length === 1 ? 'Document' : 'Documents'}</div>
      </div>
      <div class="docs-stat">
        <div class="docs-stat-value">${signOffs.length}</div>
        <div class="docs-stat-label">${signOffs.length === 1 ? 'Sign-off' : 'Sign-offs'}</div>
      </div>
      <div class="docs-stat">
        <div class="docs-stat-value ${changedCount > 0 ? 'docs-stat-changed' : ''}">${changedCount}</div>
        <div class="docs-stat-label">Changed</div>
      </div>
    </div>
  `;
}

async function renderTrackedView(
  cardsContainer: HTMLElement,
  summaryEl: HTMLElement,
  trackedDocs: TrackedDoc[],
  tier: Tier,
): Promise<void> {
  if (trackedDocs.length === 0) {
    summaryEl.innerHTML = '';
    cardsContainer.innerHTML = '<div class="empty-state"><p>No tracked documents yet.</p><p>Track a Google Doc from the Sign Off tab.</p></div>';
    return;
  }

  const isFree = tier === 'free';
  const maxTracked = TIER_LIMITS[tier].maxTrackedDocuments;

  // Build all cards at once — no change detection for tracked docs
  const fragment = document.createDocumentFragment();

  trackedDocs.forEach((tracked) => {
    const card = document.createElement('div');
    card.className = 'doc-card';
    const trackedDate = new Date(tracked.trackedAt).toLocaleDateString();
    card.innerHTML = `
      <div class="doc-card-title">${escapeHtml(tracked.title)}</div>
      <div class="doc-card-meta">Tracking since ${trackedDate}</div>
    `;

    card.addEventListener('click', () => {
      showTrackedDocDetail(tracked, false, cardsContainer.parentElement!);
    });

    fragment.appendChild(card);
  });

  cardsContainer.appendChild(fragment);

  const limitLabel = isFree ? `${trackedDocs.length} of ${maxTracked}` : String(trackedDocs.length);
  summaryEl.innerHTML = `
    <div class="docs-summary-stats">
      <div class="docs-stat">
        <div class="docs-stat-value">${trackedDocs.length}</div>
        <div class="docs-stat-label">Tracked</div>
      </div>
      <div class="docs-stat">
        <div class="docs-stat-value">${limitLabel}</div>
        <div class="docs-stat-label">${isFree ? 'Limit' : 'Total'}</div>
      </div>
    </div>
  `;
}

function showTrackedDocDetail(tracked: TrackedDoc, _hasChanged: boolean, parentContainer: HTMLElement): void {
  const diffModal = document.getElementById('diff-modal')!;
  const diffBody = document.getElementById('diff-body')!;
  const footer = document.querySelector('#diff-modal .modal-footer') as HTMLElement;

  diffModal.classList.remove('hidden');

  const trackedDate = new Date(tracked.trackedAt).toLocaleDateString();
  diffBody.innerHTML = `
    <div style="padding:4px 0;">
      <div style="font-size:15px;font-weight:600;margin-bottom:12px;">${escapeHtml(tracked.title)}</div>
      <div style="font-size:12px;color:var(--color-text-secondary);">Tracking since ${trackedDate}</div>
    </div>
  `;

  footer.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;width:100%;">
      <button class="btn btn-ghost btn-sm" id="tracked-open-doc" style="flex:1;white-space:nowrap;">Open in Google Docs</button>
      <button class="btn btn-primary btn-sm" id="tracked-sign-doc" style="flex:1;white-space:nowrap;">Sign This Doc</button>
      <button class="btn btn-danger btn-sm" id="tracked-stop" style="flex:1;white-space:nowrap;">Stop Tracking</button>
    </div>
  `;

  document.getElementById('tracked-open-doc')?.addEventListener('click', () => {
    chrome.tabs.create({ url: `https://docs.google.com/document/d/${tracked.documentId}/edit` });
  });

  document.getElementById('tracked-sign-doc')?.addEventListener('click', async () => {
    const btn = document.getElementById('tracked-sign-doc') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing...';

    try {
      const signatures = (await api.getSignatures()) as Signature[];
      if (signatures.length === 0) {
        btn.disabled = false;
        btn.textContent = 'Sign This Doc';
        const msg = document.createElement('div');
        msg.style.cssText = 'color:var(--color-danger);font-size:12px;padding:8px 0;';
        msg.textContent = 'Create a signature first in Settings.';
        footer.prepend(msg);
        return;
      }

      const sig = signatures[0]!;
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

      // Get a fresh revision ID for signing (not the baseline)
      let revisionId: string;
      if (STUB_GOOGLE_APIS) {
        const hash = await getDocTextHash(tracked.documentId);
        if (!hash) throw new Error('Cannot get document text hash');
        revisionId = hash;
      } else {
        revisionId = await getLatestRevisionId(tracked.documentId);
        const docText = await exportDocAsText(tracked.documentId);
        await storeSnapshot(tracked.documentId, revisionId, docText);
      }

      await copyImageToClipboard(imageDataUrl);
      showToast('Signature copied to clipboard — paste it into your doc');

      await api.createSignOff({
        signatureId: sig.id,
        documentId: tracked.documentId,
        revisionId,
        imageHash,
        documentTitle: tracked.title,
      });

      // Remove tracking record + baseline snapshot
      await api.untrackDoc(tracked.documentId);

      btn.textContent = 'Signed! Paste (Cmd+V)';
      btn.style.background = 'var(--color-success)';
      btn.style.borderColor = 'var(--color-success)';

      invalidateTab('documents');
      invalidateTab('signoff');

      setTimeout(() => {
        diffModal.classList.add('hidden');
        restoreFooter();
        renderDocumentsView(parentContainer);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Sign tracked doc error:', err);
      showToast(`Failed to sign: ${msg}`);
      btn.disabled = false;
      btn.textContent = 'Sign This Doc';
    }
  });

  document.getElementById('tracked-stop')?.addEventListener('click', async () => {
    const btn = document.getElementById('tracked-stop') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Removing...';

    try {
      await api.untrackDoc(tracked.documentId);
      diffModal.classList.add('hidden');
      restoreFooter();
      invalidateTab('signoff');
      renderDocumentsView(parentContainer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to stop tracking: ${msg}`);
      btn.disabled = false;
      btn.textContent = 'Stop Tracking';
    }
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
