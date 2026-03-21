import { DEV_MODE } from '../../lib/dev-mode';
import { api } from '../../lib/api';
import { getLatestRevisionId } from '../../lib/google-apis';
import { renderDocCard } from '../components/doc-card';
import { renderDiffViewer } from '../components/diff-viewer';
import type { SignOff, DocReference, DocSignOffSummary } from '@doc-align/shared';

export async function renderDocumentsView(container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="empty-state"><p>Loading documents...</p></div>';

  try {
    const [signOffs, docRefs] = await Promise.all([
      api.getSignOffs() as Promise<SignOff[]>,
      api.getDocuments() as Promise<DocReference[]>,
    ]);

    if (docRefs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No signed documents yet.</p>
          <p>Sign off on a Google Doc to see it here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    for (const docRef of docRefs) {
      const mySignOffs = signOffs.filter((so) => so.documentId === docRef.id);
      const latestSignOff = mySignOffs[0];
      if (!latestSignOff) continue;

      let hasChanged = false;
      if (!DEV_MODE) {
        try {
          const currentRevId = await getLatestRevisionId(docRef.id);
          hasChanged = currentRevId !== latestSignOff.revisionId;
        } catch {
          // Can't check — assume unchanged
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
        if (hasChanged) {
          const diffModal = document.getElementById('diff-modal')!;
          const diffBody = document.getElementById('diff-body')!;
          diffModal.classList.remove('hidden');
          renderDiffViewer(diffBody, docRef.id, latestSignOff.revisionId);
        } else {
          if (!DEV_MODE) {
            chrome.tabs.create({ url: `https://docs.google.com/document/d/${docRef.id}/edit` });
          }
        }
      });
      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load documents.</p></div>';
  }
}
