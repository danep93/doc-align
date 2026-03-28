import { computeTextDiff, diffToHtml } from '../../lib/diff-engine';
import { getRevisionContent } from '../../lib/google-apis';
import type { SignOff } from '@doc-align/shared';

export interface DiffViewerOptions {
  container: HTMLElement;
  docId: string;
  /** All sign-offs for this doc by this user, sorted newest first */
  signOffs: SignOff[];
  /** Whether the user has premium checkpoint navigation */
  isPremium: boolean;
}

export async function renderDiffViewer(
  container: HTMLElement,
  docId: string,
  signOffRevisionId: string,
): Promise<void> {
  // Legacy single-checkpoint call — render without navigation
  await renderDiffForRevision(container, docId, signOffRevisionId);
}

export async function renderDiffViewerWithCheckpoints(opts: DiffViewerOptions): Promise<void> {
  const { container, docId, signOffs, isPremium } = opts;

  if (signOffs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No sign-off history found.</p></div>';
    return;
  }

  let currentIndex = 0; // 0 = newest

  async function renderCurrent(): Promise<void> {
    const signOff = signOffs[currentIndex]!;
    const total = signOffs.length;

    // Build navigation header for premium users with multiple checkpoints
    let navHtml = '';
    if (isPremium && total > 1) {
      const newerDisabled = currentIndex === 0 ? 'disabled' : '';
      const olderDisabled = currentIndex === total - 1 ? 'disabled' : '';
      const dateStr = formatCheckpointDate(signOff.createdAt);
      navHtml = `
        <div class="checkpoint-nav" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px 0;border-bottom:1px solid var(--border);">
          <button class="btn btn-ghost btn-sm" id="checkpoint-newer" ${newerDisabled}>&larr; Newer</button>
          <span style="font-size:12px;color:var(--text-muted);">
            Checkpoint ${currentIndex + 1} of ${total} &mdash; ${dateStr}
          </span>
          <button class="btn btn-ghost btn-sm" id="checkpoint-older" ${olderDisabled}>Older &rarr;</button>
        </div>
      `;
    } else if (signOffs.length === 1) {
      const dateStr = formatCheckpointDate(signOff.createdAt);
      navHtml = `
        <div style="margin-bottom:10px;padding:4px 0;font-size:12px;color:var(--text-muted);">
          Signed off: ${dateStr}
        </div>
      `;
    }

    container.innerHTML = navHtml + '<div id="diff-content"><div class="empty-state"><p>Loading diff...</p></div></div>';

    // Attach nav button handlers
    if (isPremium && total > 1) {
      document.getElementById('checkpoint-newer')?.addEventListener('click', () => {
        if (currentIndex > 0) {
          currentIndex--;
          renderCurrent();
        }
      });
      document.getElementById('checkpoint-older')?.addEventListener('click', () => {
        if (currentIndex < total - 1) {
          currentIndex++;
          renderCurrent();
        }
      });
    }

    // Render the diff
    const diffContent = document.getElementById('diff-content')!;
    await renderDiffForRevision(diffContent, docId, signOff.revisionId);
  }

  await renderCurrent();
}

async function renderDiffForRevision(
  container: HTMLElement,
  docId: string,
  revisionId: string,
): Promise<void> {
  container.innerHTML = '<div class="empty-state"><p>Loading diff...</p></div>';

  try {
    const [oldText, newText] = await Promise.all([
      getRevisionContent(docId, revisionId),
      getRevisionContent(docId, 'head'),
    ]);

    const diffLines = computeTextDiff(oldText, newText);
    const html = diffToHtml(diffLines);

    container.innerHTML = `<div class="diff-container">${html}</div>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Diff viewer error:', err);
    container.innerHTML = `<div class="empty-state"><p>Failed to load diff: ${msg}</p><p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Try re-signing off to capture a snapshot.</p></div>`;
  }
}

function formatCheckpointDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
