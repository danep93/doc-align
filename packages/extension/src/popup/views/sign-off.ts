import { DEV_MODE } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { getLatestRevisionId, insertImageIntoDoc } from '../../lib/google-apis';
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

      const imageDataUrl = await renderSignatureImage({
        drawingDataUrl: sig.drawingData,
        name: sig.name,
        date: new Date().toLocaleDateString(),
        title: sig.title,
        organization: sig.organization,
        format: sig.format,
      });

      const imageHash = await computeImageHash(imageDataUrl);

      let revisionId: string;
      if (DEV_MODE) {
        revisionId = `rev_${Date.now()}`;
      } else {
        revisionId = await getLatestRevisionId(docContext.docId);
        await insertImageIntoDoc(docContext.docId, imageDataUrl);
      }

      await api.createSignOff({
        signatureId: sig.id,
        documentId: docContext.docId,
        revisionId,
        imageHash,
        documentTitle: docContext.title,
      });

      btn.textContent = 'Signed Off!';
      btn.style.background = 'var(--green)';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign Off on This Document';
      alert('Failed to sign off. Please try again.');
    }
  });
}

async function getDocContext(): Promise<DocContext | null> {
  if (DEV_MODE) {
    return { docId: 'dev-doc-123', title: 'Sample Product Requirements Doc' };
  }

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

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
