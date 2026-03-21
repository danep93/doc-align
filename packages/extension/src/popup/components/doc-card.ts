import type { DocSignOffSummary } from '@doc-align/shared';

export function renderDocCard(doc: DocSignOffSummary, onClick: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'doc-card';
  card.addEventListener('click', onClick);

  const statusClass = doc.hasChanged ? 'changed' : 'current';
  const statusLabel = doc.hasChanged ? 'Modified' : 'Up to date';
  const coSignerText =
    doc.totalSignOffsOnRevision > 1
      ? `You + ${doc.totalSignOffsOnRevision - 1} other${doc.totalSignOffsOnRevision > 2 ? 's' : ''}`
      : 'Only you';

  card.innerHTML = `
    <div class="doc-card-status ${statusClass}" title="${statusLabel}"></div>
    <div class="doc-card-info">
      <div class="doc-card-title">${escapeHtml(doc.title)}</div>
      <div class="doc-card-meta">Signed ${formatDate(doc.mySignOffDate)}</div>
    </div>
    <div class="doc-card-cosigners">${coSignerText}</div>
  `;
  return card;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
