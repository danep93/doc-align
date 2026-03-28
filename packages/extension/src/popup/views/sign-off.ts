import { DEV_MODE } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { getLatestRevisionId, exportDocAsText, storeSnapshot } from '../../lib/google-apis';
import { renderSignatureImage, computeImageHash } from '../../lib/signature-renderer';
import type { Signature } from '@doc-align/shared';

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

  const signatures = (await api.getSignatures()) as Signature[];

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

  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Current Document</div>
      <div style="font-size:14px;font-weight:500;margin-top:4px;">${escapeHtml(docContext.title)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Your Signature</div>
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
    <button class="btn btn-primary" id="sign-off-btn" style="width:100%;">Sign Off on This Document</button>
  `;

  document.getElementById('sign-off-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sign-off-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing off...';

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
        // Use document text hash as revision ID for change detection
        revisionId = await getDocTextHash();
      } else {
        revisionId = await getLatestRevisionId(docContext.docId);
        // Store text snapshot for later diff comparison
        const docText = await exportDocAsText(docContext.docId);
        await storeSnapshot(docContext.docId, revisionId, docText);
        console.log(`[doc-align] Snapshot stored: doc=${docContext.docId}, rev=${revisionId}, length=${docText.length}`);
      }

      // Copy signature image to clipboard for user to paste
      await copyImageToClipboard(imageDataUrl);
      showToast('Signature copied to clipboard — paste it into your doc (⌘V)');

      await api.createSignOff({
        signatureId: sig.id,
        documentId: docContext.docId,
        revisionId,
        imageHash,
        documentTitle: docContext.title,
      });

      btn.textContent = 'Signed! Paste into doc (⌘V)';
      btn.style.background = 'var(--color-success)';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign Off on This Document';
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Sign-off error:', err);
      alert(`Failed to sign off: ${msg}`);
    }
  });

}

async function getDocContext(): Promise<DocContext | null> {
  // Always get real doc context from the active tab's content script
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.includes('docs.google.com/document')) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_DOC_INFO' }, (response) => {
        if (chrome.runtime.lastError || !response?.docId) {
          resolve(null);
          return;
        }
        resolve({ docId: response.docId, title: response.title });
      });
    });
  });
}

async function getDocTextHash(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        reject(new Error('No active tab'));
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_DOC_TEXT_HASH' }, (response) => {
        if (chrome.runtime.lastError || !response?.hash) {
          reject(new Error('Failed to get doc text hash'));
          return;
        }
        resolve(response.hash);
      });
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

  // Trigger animation
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
