import { computeTextDiff, diffToHtml } from '../../lib/diff-engine';
import { getRevisionContent } from '../../lib/google-apis';

export async function renderDiffViewer(
  container: HTMLElement,
  docId: string,
  signOffRevisionId: string,
): Promise<void> {
  container.innerHTML = '<div class="empty-state"><p>Loading diff...</p></div>';

  try {
    const [oldText, newText] = await Promise.all([
      getRevisionContent(docId, signOffRevisionId),
      getRevisionContent(docId, 'head'),
    ]);

    const diffLines = computeTextDiff(oldText, newText);
    const html = diffToHtml(diffLines);

    container.innerHTML = `<div class="diff-container">${html}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Failed to load diff. Make sure you have access to this document.</p></div>`;
  }
}
