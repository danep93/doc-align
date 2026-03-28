import { DEV_MODE } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { getLatestRevisionId, exportDocAsText, storeSnapshot } from '../../lib/google-apis';
import { renderDocCard } from '../components/doc-card';
import { renderDiffViewerWithCheckpoints } from '../components/diff-viewer';
import { renderSignatureImage, computeImageHash } from '../../lib/signature-renderer';
import { TIER_LIMITS } from '@doc-align/shared';
import type { SignOff, DocReference, DocSignOffSummary, UserProfile, Signature, Tier } from '@doc-align/shared';

// Get text hash from the content script of a tab with the given doc ID
async function getDocTextHash(docId: string): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: `https://docs.google.com/document/d/${docId}/*` }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_DOC_TEXT_HASH' }, (response) => {
        if (chrome.runtime.lastError || !response?.hash) {
          resolve(null);
          return;
        }
        resolve(response.hash);
      });
    });
  });
}

// State for the currently displayed diff modal context
let currentDiffDocId: string | null = null;
let currentDiffDocTitle: string | null = null;

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
    if (DEV_MODE) {
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
  container.innerHTML = '<div class="empty-state"><p>Loading documents...</p></div>';

  try {
    const [signOffs, docRefs, profile] = await Promise.all([
      api.getSignOffs() as Promise<SignOff[]>,
      api.getDocuments() as Promise<DocReference[]>,
      api.getUser() as Promise<UserProfile>,
    ]);

    const tier = profile.tier as Tier;
    const isPremium = TIER_LIMITS[tier].maxCheckpointsPerDoc > 1;

    if (docRefs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No signed documents yet.</p>
          <p>Sign off on a Google Doc to see it here.</p>
        </div>
      `;
      return;
    }

    // Summary stats
    const totalDocs = docRefs.length;
    const totalSignOffs = signOffs.length;
    const changedCount = { value: 0 }; // counted during card rendering below

    container.innerHTML = '';

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

    for (const docRef of docRefs) {
      const mySignOffs = signOffs
        .filter((so) => so.documentId === docRef.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const latestSignOff = mySignOffs[0];
      if (!latestSignOff) continue;

      let hasChanged = false;
      if (DEV_MODE) {
        // In dev mode, compare stored text hash with current doc text hash
        try {
          const currentHash = await getDocTextHash(docRef.id);
          if (currentHash) {
            hasChanged = currentHash !== latestSignOff.revisionId;
          }
        } catch {
          // Can't check -- assume unchanged
        }
      } else {
        try {
          const currentRevId = await getLatestRevisionId(docRef.id);
          hasChanged = currentRevId !== latestSignOff.revisionId;
        } catch {
          // Can't check -- assume unchanged
        }
      }

      let coSignerData = { count: 1, userIds: [] as string[] };
      try {
        coSignerData = (await api.getCoSigners(docRef.id, latestSignOff.revisionId)) as {
          count: number;
          userIds: string[];
        };
      } catch {
        // Ignore
      }

      if (hasChanged) changedCount.value++;

      const summary: DocSignOffSummary = {
        documentId: docRef.id,
        title: docRef.title,
        mySignOffDate: latestSignOff.createdAt,
        myRevisionId: latestSignOff.revisionId,
        totalSignOffsOnRevision: coSignerData.count,
        signerNames: [],
        hasChanged,
      };

      const card = renderDocCard(summary, () => {
        // Store context for re-sign-off
        currentDiffDocId = docRef.id;
        currentDiffDocTitle = docRef.title;

        const diffModal = document.getElementById('diff-modal')!;
        const diffBody = document.getElementById('diff-body')!;
        diffModal.classList.remove('hidden');

        renderDiffViewerWithCheckpoints({
          container: diffBody,
          docId: docRef.id,
          signOffs: mySignOffs,
          isPremium,
        });
      });
      container.appendChild(card);
    }

    // Render summary stats
    summaryEl.innerHTML = `
      <div class="docs-summary-stats">
        <div class="docs-stat">
          <div class="docs-stat-value">${totalDocs}</div>
          <div class="docs-stat-label">${totalDocs === 1 ? 'Document' : 'Documents'}</div>
        </div>
        <div class="docs-stat">
          <div class="docs-stat-value">${totalSignOffs}</div>
          <div class="docs-stat-label">${totalSignOffs === 1 ? 'Sign-off' : 'Sign-offs'}</div>
        </div>
        <div class="docs-stat">
          <div class="docs-stat-value ${changedCount.value > 0 ? 'docs-stat-changed' : ''}">${changedCount.value}</div>
          <div class="docs-stat-label">Changed</div>
        </div>
      </div>
    `;
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load documents.</p></div>';
  }
}
