import './content.css';

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_DOC_INFO') {
    const docId = extractDocId(window.location.href);
    const title = document.title.replace(' - Google Docs', '').trim();
    sendResponse({ docId, title });
  }
  return true;
});

function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? (match[1] ?? null) : null;
}

// Signature hover detection
function setupHoverDetection(): void {
  const observer = new MutationObserver(() => {
    detectSignatureImages();
  });

  const editor = document.querySelector('.kix-appview-editor');
  if (editor) {
    observer.observe(editor, { childList: true, subtree: true });
  }

  detectSignatureImages();
}

function detectSignatureImages(): void {
  const images = document.querySelectorAll('.kix-appview-editor img');
  images.forEach((img) => {
    if ((img as HTMLElement).dataset.daProcessed) return;
    (img as HTMLElement).dataset.daProcessed = 'true';

    img.addEventListener('mouseenter', (e) => showTooltip(e as MouseEvent, img as HTMLImageElement));
    img.addEventListener('mouseleave', hideTooltip);
  });
}

let tooltipEl: HTMLElement | null = null;

function showTooltip(e: MouseEvent, _img: HTMLImageElement): void {
  hideTooltip();

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'da-tooltip';
  tooltipEl.innerHTML = `
    <div class="da-tooltip-name">Checking signature...</div>
  `;

  document.body.appendChild(tooltipEl);
  positionTooltip(e);

  const docId = extractDocId(window.location.href);
  if (docId) {
    chrome.runtime.sendMessage(
      { type: 'CHECK_SIGNATURE', docId, imgSrc: _img.src },
      (response) => {
        if (response?.found && tooltipEl) {
          const statusClass = response.hasChanged ? 'changed' : 'current';
          const statusText = response.hasChanged ? 'Document modified' : 'No changes since sign-off';
          tooltipEl.innerHTML = `
            <div class="da-tooltip-name">${escapeHtml(response.signerName)}</div>
            <div class="da-tooltip-date">Signed ${response.signedDate}</div>
            <div class="da-tooltip-status">
              <div class="da-tooltip-dot ${statusClass}"></div>
              ${statusText}
            </div>
            ${response.hasChanged ? '<div class="da-tooltip-link">View changes</div>' : ''}
          `;
        } else if (tooltipEl) {
          hideTooltip();
        }
      },
    );
  }
}

function positionTooltip(e: MouseEvent): void {
  if (!tooltipEl) return;
  tooltipEl.style.left = `${e.pageX + 12}px`;
  tooltipEl.style.top = `${e.pageY + 12}px`;
}

function hideTooltip(): void {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Init
if (document.readyState === 'complete') {
  setupHoverDetection();
} else {
  window.addEventListener('load', setupHoverDetection);
}
