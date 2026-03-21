import type { Signature } from '@doc-align/shared';

export function renderSignatureCard(
  sig: Signature,
  onRetire: () => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'sig-card';

  card.innerHTML = `
    <div class="sig-card-preview">
      <img src="${sig.drawingData}" alt="Signature" />
    </div>
    <div class="sig-card-info">
      <div class="sig-card-name">${escapeHtml(sig.name)}</div>
      <div class="sig-card-meta">${sig.format === 'full' && sig.title ? sig.title : 'Basic signature'}</div>
    </div>
  `;

  const retireBtn = document.createElement('button');
  retireBtn.className = 'btn btn-ghost';
  retireBtn.textContent = 'Retire';
  retireBtn.style.fontSize = '11px';
  retireBtn.style.padding = '4px 8px';
  retireBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRetire();
  });
  card.appendChild(retireBtn);

  return card;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
